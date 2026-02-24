import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
export declare class KefLsxPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly config: PlatformConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly accessories: Map<string, PlatformAccessory>;
    constructor(log: Logging, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    discoverDevices(): void;
}
//# sourceMappingURL=platform.d.ts.map