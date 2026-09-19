import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Accessory, Service, Characteristic, uuid } from 'hap-nodejs';

const require = createRequire(import.meta.url);
class Speaker extends EventEmitter {
  static latest;
  calls = [];
  socketState = 'socket:connect';
  constructor(options) { super(); this.options = options; Speaker.latest = this; }
  connect() { this.emit('socket:connect'); }
  checkState() { this.calls.push(['poll']); }
  setVolume(value, cb) { this.calls.push(['volume', value]); cb(this.error); }
  turnOnOrSwitchSource(source, cb) { this.calls.push(['source', source]); cb(this.error); }
  turnOff(cb) { this.calls.push(['off']); cb(this.error); }
  end() { this.calls.push(['end']); }
}
require.cache[require.resolve('kef-wireless-js')] = { exports: Speaker };
const { KefAccessory } = await import('../dist/kefAccessory.js');

function setup(config = {}) {
  const accessory = new Accessory('Test KEF', uuid.generate('test-kef'));
  accessory.context = { config: { ip: '127.0.0.1', ...config } };
  const api = new EventEmitter();
  const controller = new KefAccessory({ Service, Characteristic, api,
    log: { info() {}, warn() {}, error() {} } }, accessory);
  const speaker = Speaker.latest;
  const volume = accessory.getService(Service.Lightbulb);
  const mute = accessory.getService(Service.Switch);
  const tv = accessory.getService(Service.Television);
  const state = (changes = {}) => speaker.emit('state', {
    volume: 30, muted: false, onoff: 1, source: 'OPT', socketState: 'socket:connect', ...changes,
  });
  return { accessory, controller, speaker, volume, mute, tv, state, api };
}
const write = (service, characteristic, value) => service.getCharacteristic(characteristic).handleSetRequest(value);
const read = (service, characteristic) => service.getCharacteristic(characteristic).value;

test('power-only changes update the volume tile', () => {
  const { state, volume } = setup();
  state();
  assert.equal(read(volume, Characteristic.On), true);
  state({ onoff: 0 });
  assert.equal(read(volume, Characteristic.On), false);
  state();
  assert.equal(read(volume, Characteristic.On), true);
});

test('repeated mute writes are absolute, including rapid opposite writes', async () => {
  const { state, volume, mute, speaker } = setup();
  state({ muted: true });
  await write(volume, Characteristic.On, false);
  await write(volume, Characteristic.On, false);
  await write(mute, Characteristic.On, false);
  await write(mute, Characteristic.On, true);
  assert.deepEqual(speaker.calls.slice(1), [
    ['volume', 158], ['volume', 158], ['volume', 30], ['volume', 158],
  ]);
});

test('volume is capped and unchanged polls correct optimistic HomeKit values', async () => {
  const { state, volume, speaker } = setup();
  state();
  await write(volume, Characteristic.Brightness, 90);
  assert.deepEqual(speaker.calls.at(-1), ['volume', 50]);
  state();
  assert.equal(read(volume, Characteristic.Brightness), 30);
});

test('unknown transition state preserves the last known input and volume', () => {
  const { state, volume, mute, tv } = setup();
  state({ muted: true });
  state({ source: -1, volume: -1, muted: null });
  assert.equal(read(tv, Characteristic.ActiveIdentifier), 1);
  assert.equal(read(volume, Characteristic.Brightness), 30);
  assert.equal(read(mute, Characteristic.On), true);
});

test('startup polls immediately and unknown mute cannot send an invented volume', async () => {
  const { speaker, volume } = setup();
  assert.equal(speaker.options.emitUnchangedState, true);
  assert.deepEqual(speaker.calls, [['poll']]);
  await assert.rejects(write(volume, Characteristic.On, false));
  assert.deepEqual(speaker.calls, [['poll']]);
});

test('socket failures propagate to HomeKit and disconnected power writes fail', async () => {
  const { speaker, volume, tv } = setup();
  speaker.error = 'Write failed';
  await assert.rejects(write(volume, Characteristic.Brightness, 25));
  speaker.socketState = 'socket:close';
  await assert.rejects(write(tv, Characteristic.Active, 1));
});

test('disconnect invalidates volume before mute commands and shutdown closes connection', async () => {
  const { speaker, state, mute, api } = setup();
  state();
  speaker.emit('socket:close');
  await assert.rejects(write(mute, Characteristic.On, true));
  api.emit('shutdown');
  assert.deepEqual(speaker.calls.at(-1), ['end']);
});
