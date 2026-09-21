import { createRequire } from 'module';
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { KefLsxPlatform } from './platform.js';

// kef-wireless-js is CommonJS with no type declarations
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KEF = require('kef-wireless-js') as any;

// State events also contain cached volume when only the source changed.
// Expose actual volume replies so startup never restores a standby volume.
class KefSpeaker extends KEF {
  constructor(options: Record<string, unknown>) {
    super(options);
  }

  handleData(data: Buffer) {
    super.handleData(data);
    if (data.length >= 5 && data[0] === 0x52 && data[1] === 0x25) {
      this.emit('volume-report', this.toJSON());
    }
  }
}

interface KefState {
  volume: number;
  muted: boolean | null;
  source: string | number; // string like 'WIFI' or -1 when unknown
  socketState: string;
  onoff: number; // 1 = on, 0 = off, -1 = unknown
}

const SOURCES = [
  { id: 0, name: 'AUX',  kef: 'AUX'  },
  { id: 1, name: 'OPT',  kef: 'OPT'  },
  { id: 2, name: 'BT',   kef: 'BT'   },
  { id: 3, name: 'USB',  kef: 'USB'  },
  { id: 4, name: 'WIFI', kef: 'WIFI' },
] as const;

export class KefAccessory {
  private tvService: Service;
  private volumeService: Service;
  private muteService: Service;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private speaker: any;

  private maxVolume: number;
  private unmuteOnPowerOn: boolean;
  private wake?: { ready: boolean; writing: boolean; attempts: number; timer: NodeJS.Timeout };

  private state: KefState = {
    volume: -1,
    muted: null,
    source: 'WIFI',
    socketState: 'disconnected',
    onoff: -1,
  };

  constructor(
    private readonly platform: KefLsxPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = this.platform;
    const config = accessory.context.config as {
      ip: string;
      name?: string;
      maxVolume?: number;
      unmuteOnPowerOn?: boolean;
      checkStateInterval?: number;
    };

    this.unmuteOnPowerOn = config.unmuteOnPowerOn ?? true;
    this.maxVolume = config.maxVolume ?? 50;
    if (!Number.isInteger(this.maxVolume) || this.maxVolume < 1 || this.maxVolume > 100) {
      throw new Error('maxVolume must be an integer between 1 and 100');
    }
    const interval = config.checkStateInterval ?? 5000;
    if (!Number.isInteger(interval) || interval < 1000) {
      throw new Error('checkStateInterval must be an integer of at least 1000 ms');
    }

    // Accessory info
    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'KEF')
      .setCharacteristic(Characteristic.Model, 'LSX')
      .setCharacteristic(Characteristic.SerialNumber, config.ip);

    // Television service — power + input switching
    this.tvService = this.accessory.getService(Service.Television)
      ?? this.accessory.addService(Service.Television);

    this.tvService
      .setCharacteristic(Characteristic.ConfiguredName, config.name ?? 'KEF LSX')
      .setCharacteristic(
        Characteristic.SleepDiscoveryMode,
        Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    this.tvService.getCharacteristic(Characteristic.Active)
      .onGet(() =>
        this.state.onoff === 1
          ? Characteristic.Active.ACTIVE
          : Characteristic.Active.INACTIVE,
      )
      .onSet(this.handleActiveSet.bind(this));

    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.sourceToId(this.state.source))
      .onSet(this.handleInputSet.bind(this));

    // RemoteKey: map PLAY_PAUSE to power toggle
    this.tvService.getCharacteristic(Characteristic.RemoteKey)
      .onSet(async (value: CharacteristicValue) => {
        if (value === Characteristic.RemoteKey.PLAY_PAUSE) {
          await this.handleActiveSet(this.state.onoff === 1
            ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE);
        }
      });

    // InputSource services — one per KEF source
    for (const src of SOURCES) {
      const inputService = this.accessory.getService(src.name)
        ?? this.accessory.addService(Service.InputSource, src.name, src.name);

      inputService
        .setCharacteristic(Characteristic.Identifier, src.id)
        .setCharacteristic(Characteristic.ConfiguredName, src.name)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(
          Characteristic.CurrentVisibilityState,
          Characteristic.CurrentVisibilityState.SHOWN,
        )
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER);

      this.tvService.addLinkedService(inputService);
    }

    // Lightbulb service — volume control
    this.volumeService = this.accessory.getService(Service.Lightbulb)
      ?? this.accessory.addService(Service.Lightbulb, 'Volume', 'volume');

    this.volumeService.setCharacteristic(Characteristic.Name, 'Volume');

    this.volumeService.getCharacteristic(Characteristic.On)
      .onGet(() => !this.state.muted && this.state.onoff === 1)
      .onSet(async (value: CharacteristicValue) => {
        // An already-off tile must not latch mute for the next startup.
        if (!value && this.state.onoff === 0 && !this.wake) return;
        await this.setMuted(!value);
      });

    this.volumeService.getCharacteristic(Characteristic.Brightness)
      .onGet(() => Math.max(0, this.state.volume))
      .onSet(async (value: CharacteristicValue) => {
        this.cancelWake();
        const volume = Math.min(this.maxVolume, Math.max(0, Math.round(Number(value))));
        if (!Number.isFinite(volume)) throw new Error('Invalid volume');
        await this.command(cb => this.speaker.setVolume(volume, cb));
      });

    // Switch service — mute toggle
    this.muteService = this.accessory.getService(Service.Switch)
      ?? this.accessory.addService(Service.Switch, 'Mute', 'mute');

    this.muteService.setCharacteristic(Characteristic.Name, 'Mute');

    this.muteService.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.muted ?? false)
      .onSet(async (value: CharacteristicValue) => {
        await this.setMuted(Boolean(value));
      });

    // Initialize KEF speaker connection
    this.speaker = new KefSpeaker({
      ip: config.ip,
      connectOnInstantiation: false,
      emitUnchangedState: true,
      maxVolume: this.maxVolume,
      checkStateInterval: interval,
    });

    this.speaker.on('state', (newState: KefState) => {
      this.syncState(newState);
    });

    this.speaker.on('volume-report', (report: KefState) => {
      void this.finishWake(report);
    });

    this.speaker.on('socket:error', (err: Error) => {
      this.platform.log.error('KEF socket error:', err.message);
    });

    this.speaker.on('socket:close', () => {
      this.cancelWake();
      this.state = { ...this.state, volume: -1, muted: null, onoff: -1 };
      this.platform.log.warn('KEF speaker disconnected');
    });

    this.speaker.on('socket:connect', () => {
      this.platform.log.info('KEF speaker connected at', config.ip);
      this.speaker.checkState();
    });
    this.platform.api.on('shutdown', () => {
      this.cancelWake();
      clearInterval(this.speaker.checkStateLoop);
      clearTimeout(this.speaker.reconnectLoop);
      this.speaker.end();
    });
    this.speaker.connect();
  }

  // KEF callbacks report socket write failures; they do not confirm device state.
  private command(write: (cb: (error?: Error | string | null) => void) => void): Promise<void> {
    if (this.speaker.socketState !== 'socket:connect') {
      return Promise.reject(new Error('KEF speaker is disconnected'));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('KEF command timed out')), 3000);
      try {
        write(error => {
          clearTimeout(timeout);
          if (error) reject(error instanceof Error ? error : new Error(error));
          else resolve();
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  private cancelWake() {
    if (this.wake) clearTimeout(this.wake.timer);
    this.wake = undefined;
  }

  private async turnOn(source: string) {
    if (this.unmuteOnPowerOn && this.state.onoff !== 1 && !this.wake) {
      const timer = setTimeout(() => {
        this.cancelWake();
        this.platform.log.warn('KEF startup unmute timed out; check speaker connectivity and mute state');
      }, 20000);
      timer.unref();
      this.wake = { ready: false, writing: false, attempts: 0, timer };
    }
    try {
      await this.command(cb => this.speaker.turnOnOrSwitchSource(source, cb));
    } catch (error) {
      this.cancelWake();
      throw error;
    }
  }

  private async finishWake(report: KefState) {
    const wake = this.wake;
    if (!wake?.ready || wake.writing || report.onoff !== 1 ||
        !Number.isInteger(report.volume) || report.volume < 0 || report.volume > 100 ||
        typeof report.muted !== 'boolean') return;
    if (!report.muted) {
      this.cancelWake();
      return;
    }
    if (wake.attempts >= 3) return; // The deadline reports failure if mute persists.
    wake.writing = true;
    wake.attempts++;
    try {
      await this.command(cb => this.speaker.setVolume(Math.min(report.volume, this.maxVolume), cb));
      // Keep waiting for a volume reply confirming unmute, not just a socket ACK.
    } catch (error) {
      if (this.wake === wake) {
        this.cancelWake();
        this.platform.log.warn('KEF startup unmute failed:', String(error));
      }
    } finally {
      wake.writing = false;
    }
  }

  private async setMuted(muted: boolean) {
    this.cancelWake();
    if (this.state.volume < 0 || this.state.muted === null) {
      throw new Error('KEF volume/mute state is not available yet');
    }
    // Send an absolute mute bit, so repeated writes cannot undo one another.
    const volume = Math.min(this.state.volume, this.maxVolume);
    await this.command(cb => this.speaker.setVolume(volume + (muted ? 128 : 0), cb));
  }

  private async handleActiveSet(value: CharacteristicValue) {
    if (value === this.platform.Characteristic.Active.ACTIVE) {
      const source = this.validSource(this.state.source);
      await this.turnOn(source);
    } else {
      this.cancelWake();
      await this.command(cb => this.speaker.turnOff(cb));
    }
  }

  private async handleInputSet(value: CharacteristicValue) {
    const src = SOURCES.find(s => s.id === (value as number));
    if (!src) return;
    await this.turnOn(src.kef);
  }

  private syncState(newState: KefState) {
    const { Characteristic } = this.platform;
    // Ignore unknown startup/transition fields; preserve the last valid input.
    this.state = {
      ...this.state,
      socketState: newState.socketState,
      ...(newState.onoff === 0 || newState.onoff === 1 ? { onoff: newState.onoff } : {}),
      ...(typeof newState.source === 'string' && SOURCES.some(s => s.kef === newState.source)
        ? { source: newState.source } : {}),
      ...(Number.isInteger(newState.volume) && newState.volume >= 0 && newState.volume <= 100
        ? { volume: newState.volume } : {}),
      ...(typeof newState.muted === 'boolean' ? { muted: newState.muted } : {}),
    };
    if (this.wake && !this.wake.ready && newState.onoff === 1 &&
        typeof newState.source === 'string' && SOURCES.some(s => s.kef === newState.source)) {
      this.wake.ready = true;
      this.speaker.getVolume();
    }
    // Publish each poll, even when unchanged, to reconcile HomeKit's optimistic writes.
    if (this.state.onoff !== -1) {
      this.tvService.updateCharacteristic(Characteristic.Active, this.state.onoff === 1
        ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
    }
    this.tvService.updateCharacteristic(Characteristic.ActiveIdentifier, this.sourceToId(this.state.source));
    if (this.state.volume >= 0) {
      this.volumeService.updateCharacteristic(Characteristic.Brightness, this.state.volume);
    }
    if (this.state.muted !== null) {
      this.volumeService.updateCharacteristic(Characteristic.On, !this.state.muted && this.state.onoff === 1);
      this.muteService.updateCharacteristic(Characteristic.On, this.state.muted);
    }
  }

  private sourceToId(source: string | number): number {
    if (typeof source !== 'string') return 4; // unknown → default WIFI
    return SOURCES.find(s => s.kef === source)?.id ?? 4;
  }

  private validSource(source: string | number): string {
    if (typeof source === 'string' && SOURCES.some(s => s.kef === source)) {
      return source;
    }
    return 'WIFI';
  }
}
