import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Accessory, Service, Characteristic, uuid } from 'hap-nodejs';

const require = createRequire(import.meta.url);
const RealKEF = require('kef-wireless-js');
class Speaker extends EventEmitter {
  static latest;
  calls = [];
  socketState = 'socket:connect';
  constructor(options) { super(); this.options = options; Speaker.latest = this; }
  handleData(data) { RealKEF.prototype.handleData.call(this, data); }
  toJSON() { return RealKEF.prototype.toJSON.call(this); }
  connect() { this.emit('socket:connect'); }
  getVolume() { this.calls.push(['getVolume']); }
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

const tick = () => new Promise(resolve => setImmediate(resolve));
function report(speaker, changes = {}) {
  speaker.emit('volume-report', { volume: 35, muted: true, onoff: 1, source: 'OPT', ...changes });
}

test('wake waits through transition and uses fresh volume, then confirms unmute', async () => {
  const { state, speaker, tv, controller } = setup();
  state({ onoff: 0, volume: 10, muted: true });
  await write(tv, Characteristic.Active, 1);
  state({ source: -1, muted: true });
  report(speaker);
  assert.equal(speaker.calls.some(c => c[0] === 'volume'), false);
  state({ muted: true, volume: 10 });
  assert.deepEqual(speaker.calls.at(-1), ['getVolume']);
  report(speaker, { volume: 80 });
  await tick();
  assert.deepEqual(speaker.calls.at(-1), ['volume', 50]);
  assert.ok(controller.wake);
  report(speaker, { muted: false });
  assert.equal(controller.wake, undefined);
});

test('input selection wakes and unmutes, but switching an active input preserves mute', async () => {
  const { state, speaker, tv, api } = setup();
  state({ onoff: 0, muted: true });
  await write(tv, Characteristic.ActiveIdentifier, 1);
  state({ muted: true });
  report(speaker);
  await tick();
  assert.deepEqual(speaker.calls.at(-1), ['volume', 35]);
  report(speaker, { muted: false });
  state({ muted: true });
  await write(tv, Characteristic.ActiveIdentifier, 0);
  report(speaker);
  assert.deepEqual(speaker.calls.at(-1), ['source', 'AUX']);
  api.emit('shutdown');
});

test('manual mute cancels startup unmute', async () => {
  const { state, speaker, tv, mute } = setup();
  state({ onoff: 0 });
  await write(tv, Characteristic.Active, 1);
  state({ muted: true });
  await write(mute, Characteristic.On, true);
  report(speaker);
  await tick();
  assert.deepEqual(speaker.calls.at(-1), ['volume', 158]);
});

test('Volume off in standby does not latch mute', async () => {
  const { state, speaker, volume } = setup();
  state({ onoff: 0 });
  await write(volume, Characteristic.On, false);
  assert.deepEqual(speaker.calls, [['poll']]);
});

test('startup unmute is opt-out and never runs on reconnect alone', async () => {
  for (const config of [{ unmuteOnPowerOn: false }, {}]) {
    const { state, speaker, tv } = setup(config);
    state({ onoff: 0, muted: true });
    if (config.unmuteOnPowerOn === false) await write(tv, Characteristic.Active, 1);
    state({ muted: true });
    report(speaker);
    assert.equal(speaker.calls.some(c => c[0] === 'volume'), false);
  }
});

test('shutdown, disconnect and power-off cancel pending wake', async () => {
  for (const action of ['shutdown', 'disconnect', 'off']) {
    const { state, speaker, tv, api, controller } = setup();
    state({ onoff: 0 });
    await write(tv, Characteristic.Active, 1);
    if (action === 'shutdown') api.emit('shutdown');
    else if (action === 'disconnect') speaker.emit('socket:close');
    else await write(tv, Characteristic.Active, 0);
    report(speaker);
    assert.equal(controller.wake, undefined);
    assert.equal(speaker.calls.some(c => c[0] === 'volume'), false);
  }
});

test('wake deadline stops late unmuting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { state, speaker, tv, controller } = setup();
  state({ onoff: 0 });
  await write(tv, Characteristic.Active, 1);
  t.mock.timers.tick(20000);
  state({ muted: true });
  report(speaker);
  assert.equal(controller.wake, undefined);
  assert.equal(speaker.calls.some(c => c[0] === 'volume'), false);
});


test('actual KEF parser delivers fresh volume replies to startup unmute', async () => {
  const { state, speaker, tv, controller } = setup();
  state({ onoff: 0, muted: true });
  await write(tv, Characteristic.Active, 1);
  speaker.volume = 10;
  speaker.muted = true;
  speaker.handleData(Buffer.from([0x52, 0x30, 0x81, 0x1b, 0]));
  assert.deepEqual(speaker.calls.at(-1), ['getVolume']);
  speaker.handleData(Buffer.from([0x52, 0x25, 0x81, 128 + 42, 0]));
  await tick();
  assert.deepEqual(speaker.calls.at(-1), ['volume', 42]);
  speaker.handleData(Buffer.from([0x52, 0x25, 0x81, 42, 0]));
  assert.equal(controller.wake, undefined);
});

test('speaker that ignores unmute gets at most three attempts', async () => {
  const { state, speaker, tv, api } = setup();
  state({ onoff: 0 });
  await write(tv, Characteristic.Active, 1);
  state({ muted: true });
  for (let i = 0; i < 5; i++) { report(speaker); await tick(); }
  assert.equal(speaker.calls.filter(c => c[0] === 'volume').length, 3);
  api.emit('shutdown');
});
