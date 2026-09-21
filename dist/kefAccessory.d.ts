import type { PlatformAccessory } from 'homebridge';
import type { KefLsxPlatform } from './platform.js';
export declare class KefAccessory {
    private readonly platform;
    private readonly accessory;
    private tvService;
    private volumeService;
    private muteService;
    private speaker;
    private maxVolume;
    private unmuteOnPowerOn;
    private wake?;
    private state;
    constructor(platform: KefLsxPlatform, accessory: PlatformAccessory);
    private command;
    private cancelWake;
    private turnOn;
    private finishWake;
    private setMuted;
    private handleActiveSet;
    private handleInputSet;
    private syncState;
    private sourceToId;
    private validSource;
}
//# sourceMappingURL=kefAccessory.d.ts.map