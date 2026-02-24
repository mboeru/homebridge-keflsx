import { KefAccessory } from './kefAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
export class KefLsxPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = new Map();
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }
    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }
    discoverDevices() {
        if (!this.config.ip) {
            this.log.error('No IP address configured for KEF LSX. Plugin will not start.');
            return;
        }
        const uuid = this.api.hap.uuid.generate(this.config.ip);
        const existingAccessory = this.accessories.get(uuid);
        if (existingAccessory) {
            this.log.info('Restoring KEF LSX accessory from cache:', existingAccessory.displayName);
            existingAccessory.context.config = this.config;
            this.api.updatePlatformAccessories([existingAccessory]);
            new KefAccessory(this, existingAccessory);
        }
        else {
            this.log.info('Adding new KEF LSX accessory');
            const accessory = new this.api.platformAccessory(this.config.name || 'KEF LSX', uuid, 31 /* this.api.hap.Categories.TELEVISION */);
            accessory.context.config = this.config;
            new KefAccessory(this, accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
    }
}
//# sourceMappingURL=platform.js.map