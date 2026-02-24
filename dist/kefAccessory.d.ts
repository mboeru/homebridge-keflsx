import type { PlatformAccessory } from 'homebridge';
import type { KefLsxPlatform } from './platform.js';
export declare class KefAccessory {
    private readonly platform;
    private readonly accessory;
    private tvService;
    private volumeService;
    private muteService;
    private speaker;
    private state;
    constructor(platform: KefLsxPlatform, accessory: PlatformAccessory);
    private handleActiveSet;
    private handleInputSet;
    private syncState;
    private sourceToId;
    private validSource;
}
//# sourceMappingURL=kefAccessory.d.ts.map