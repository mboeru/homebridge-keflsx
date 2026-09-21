# homebridge-keflsx

A [Homebridge](https://homebridge.io) plugin for controlling **KEF LSX (Gen 1)** wireless speakers via Apple HomeKit.

Uses [kef-wireless-js](https://www.npmjs.com/package/kef-wireless-js) to communicate with the speakers over the local network.

**<u>This plugin was developed with AI assistance.</u>**

## Features

- **Power on/off** -- Turn speakers on and off via a Television service tile
- **Input switching** -- Switch between AUX, OPT, BT, USB, and WIFI inputs
- **Volume control** -- Adjust volume via a Lightbulb brightness slider (0-100)
- **Mute toggle** -- Dedicated switch to mute/unmute the speakers

State is polled immediately on connection and then at the configured interval.
Changes made with the KEF app or remote appear in HomeKit on the next poll.
Volume requests above `maxVolume` are capped at that limit; the slider then
shows the volume reported by the speaker. The limit applies to plugin commands,
not volume changes made with the KEF app or remote.

The Volume tile's on/off control sets mute explicitly, so repeating a command
cannot accidentally toggle mute back. Turning Volume off while already in standby
is a no-op. HomeKit power-on (including input selection while off) now unmutes
once the speaker reports a valid input and a fresh volume, capped at `maxVolume`.
Startup unmute expires after 20 seconds and attempts at most three writes.
Explicit mute/volume commands, power-off, disconnect, and shutdown cancel it.
Set `unmuteOnPowerOn` to `false` to preserve mute across startup. Switching inputs
while already on, restarting Homebridge, and powering on with a physical remote
do not automatically unmute. Mute commands require a known speaker volume,
and unavailable connections or failed writes are reported to HomeKit.

## How it appears in HomeKit

| Tile | Type | Controls |
|---|---|---|
| KEF LSX | Television | Power on/off, input selection |
| Volume | Lightbulb | Volume (brightness slider), mute (on/off) |
| Mute | Switch | Mute toggle |

## Installation

```bash
npm install -g homebridge-keflsx
```

Or install via the Homebridge UI by searching for `homebridge-keflsx`.

## Configuration

Add the following to the `platforms` array in your Homebridge `config.json`:

```json
{
    "platform": "KefLsxPlatform",
    "name": "KEF LSX",
    "ip": "192.168.1.100"
}
```

### Settings

| Setting | Required | Default | Description |
|---|---|---|---|
| `platform` | Yes | -- | Must be `KefLsxPlatform` |
| `name` | Yes | `KEF LSX` | Display name in HomeKit |
| `ip` | Yes | -- | Local IP address of the KEF LSX speaker |
| `maxVolume` | No | `50` | Maximum volume level allowed (1-100). Safety limit to prevent accidental high volume. |
| `unmuteOnPowerOn` | No | `true` | Unmute after HomeKit wakes the speaker. |
| `checkStateInterval` | No | `5000` | How often to poll speaker state in milliseconds. Minimum 1000. |

### Full example

```json
{
    "platform": "KefLsxPlatform",
    "name": "KEF LSX",
    "ip": "192.168.55.71",
    "maxVolume": 50,
    "checkStateInterval": 5000
}
```

## Development

```bash
git clone https://github.com/your-username/homebridge-keflsx.git
cd homebridge-keflsx
npm install
npm test
npm link
```

Then restart Homebridge to load the plugin.

## Installing the 1.0.1 package in your container

Copy `homebridge-keflsx-1.0.1.tgz` to the Docker host, then run there
(replace `CONTAINER_NAME` with your container name):

```bash
docker cp ./homebridge-keflsx-1.0.1.tgz CONTAINER_NAME:/homebridge/homebridge-keflsx-1.0.1.tgz
```

In the Homebridge UI terminal:

```bash
cd /homebridge
npm install --save ./homebridge-keflsx-1.0.1.tgz
npm ls homebridge-keflsx
```

Restart Homebridge in the UI. Keep the archive in the persistent `/homebridge`
volume because npm records its local path as the dependency source. Existing
configuration and pairing can be reused. The package must first be copied from
the development machine; a version bump alone does not publish it to GitHub or npm.

To verify: mute, power off, wait for standby, and power on from HomeKit.
The speaker should unmute after startup. Then verify that explicitly muting
during startup remains muted. Check logs for startup-unmute timeout warnings.
The plugin still uses TCP 50001; the UPnP service on 8080 is not a replacement
for the KEF power/input protocol in this release.
