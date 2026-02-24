import { createRequire } from 'module';
// kef-wireless-js is CommonJS with no type declarations
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const KEF = require('kef-wireless-js');
const SOURCES = [
    { id: 0, name: 'AUX', kef: 'AUX' },
    { id: 1, name: 'OPT', kef: 'OPT' },
    { id: 2, name: 'BT', kef: 'BT' },
    { id: 3, name: 'USB', kef: 'USB' },
    { id: 4, name: 'WIFI', kef: 'WIFI' },
];
export class KefAccessory {
    platform;
    accessory;
    tvService;
    volumeService;
    muteService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    speaker;
    state = {
        volume: 0,
        muted: false,
        source: 'WIFI',
        socketState: 'disconnected',
        onoff: -1,
    };
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        const { Service, Characteristic } = this.platform;
        const config = accessory.context.config;
        // Accessory info
        this.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'KEF')
            .setCharacteristic(Characteristic.Model, 'LSX')
            .setCharacteristic(Characteristic.SerialNumber, config.ip);
        // Television service — power + input switching
        this.tvService = this.accessory.getService(Service.Television)
            ?? this.accessory.addService(Service.Television);
        this.tvService
            .setCharacteristic(Characteristic.ConfiguredName, config.name ?? 'KEF LSX')
            .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
        this.tvService.getCharacteristic(Characteristic.Active)
            .onGet(() => this.state.onoff === 1
            ? Characteristic.Active.ACTIVE
            : Characteristic.Active.INACTIVE)
            .onSet(this.handleActiveSet.bind(this));
        this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
            .onGet(() => this.sourceToId(this.state.source))
            .onSet(this.handleInputSet.bind(this));
        // RemoteKey: map PLAY_PAUSE to power toggle
        this.tvService.getCharacteristic(Characteristic.RemoteKey)
            .onSet(async (value) => {
            if (value === Characteristic.RemoteKey.PLAY_PAUSE) {
                if (this.state.onoff === 1) {
                    this.speaker.turnOff();
                }
                else {
                    this.speaker.turnOnOrSwitchSource(this.validSource(this.state.source));
                }
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
                .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
                .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER);
            this.tvService.addLinkedService(inputService);
        }
        // Lightbulb service — volume control
        this.volumeService = this.accessory.getService(Service.Lightbulb)
            ?? this.accessory.addService(Service.Lightbulb, 'Volume', 'volume');
        this.volumeService.setCharacteristic(Characteristic.Name, 'Volume');
        this.volumeService.getCharacteristic(Characteristic.On)
            .onGet(() => !this.state.muted && this.state.onoff === 1)
            .onSet(async (value) => {
            if (!value) {
                this.speaker.muteToggle();
            }
            else if (this.state.muted) {
                this.speaker.muteToggle();
            }
        });
        this.volumeService.getCharacteristic(Characteristic.Brightness)
            .onGet(() => Math.max(0, this.state.volume))
            .onSet(async (value) => {
            this.speaker.setVolume(value);
        });
        // Switch service — mute toggle
        this.muteService = this.accessory.getService(Service.Switch)
            ?? this.accessory.addService(Service.Switch, 'Mute', 'mute');
        this.muteService.setCharacteristic(Characteristic.Name, 'Mute');
        this.muteService.getCharacteristic(Characteristic.On)
            .onGet(() => this.state.muted)
            .onSet(async (value) => {
            if (value !== this.state.muted) {
                this.speaker.muteToggle();
            }
        });
        // Initialize KEF speaker connection
        this.speaker = new KEF({
            ip: config.ip,
            connectOnInstantiation: true,
            maxVolume: config.maxVolume ?? 50,
            checkStateInterval: config.checkStateInterval ?? 5000,
        });
        this.speaker.on('state', (newState) => {
            this.syncState(newState);
        });
        this.speaker.on('socket:error', (err) => {
            this.platform.log.error('KEF socket error:', err.message);
        });
        this.speaker.on('socket:disconnect', () => {
            this.platform.log.warn('KEF speaker disconnected');
        });
        this.speaker.on('socket:connect', () => {
            this.platform.log.info('KEF speaker connected at', config.ip);
        });
    }
    async handleActiveSet(value) {
        if (value === this.platform.Characteristic.Active.ACTIVE) {
            const source = this.validSource(this.state.source);
            this.speaker.turnOnOrSwitchSource(source);
        }
        else {
            this.speaker.turnOff();
        }
    }
    async handleInputSet(value) {
        const src = SOURCES.find(s => s.id === value);
        if (!src)
            return;
        this.speaker.turnOnOrSwitchSource(src.kef);
    }
    syncState(newState) {
        const { Characteristic } = this.platform;
        const prev = this.state;
        this.state = newState;
        if (newState.onoff !== prev.onoff) {
            this.tvService.updateCharacteristic(Characteristic.Active, newState.onoff === 1 ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
        }
        if (newState.source !== prev.source) {
            this.tvService.updateCharacteristic(Characteristic.ActiveIdentifier, this.sourceToId(newState.source));
        }
        if (newState.volume !== prev.volume) {
            this.volumeService.updateCharacteristic(Characteristic.Brightness, Math.max(0, newState.volume));
        }
        if (newState.muted !== prev.muted) {
            this.volumeService.updateCharacteristic(Characteristic.On, !newState.muted && newState.onoff === 1);
            this.muteService.updateCharacteristic(Characteristic.On, newState.muted);
        }
    }
    sourceToId(source) {
        if (typeof source !== 'string')
            return 4; // unknown → default WIFI
        return SOURCES.find(s => s.kef === source)?.id ?? 4;
    }
    validSource(source) {
        if (typeof source === 'string' && SOURCES.some(s => s.kef === source)) {
            return source;
        }
        return 'WIFI';
    }
}
//# sourceMappingURL=kefAccessory.js.map