# homebridge-keflsx

A [Homebridge](https://homebridge.io) plugin for controlling **KEF LSX (Gen 1)** wireless speakers via Apple HomeKit.

Uses [kef-wireless-js](https://www.npmjs.com/package/kef-wireless-js) to communicate with the speakers over the local network.

## Features

- **Power on/off** -- Turn speakers on and off via a Television service tile
- **Input switching** -- Switch between AUX, OPT, BT, USB, and WIFI inputs
- **Volume control** -- Adjust volume via a Lightbulb brightness slider (0-100)
- **Mute toggle** -- Dedicated switch to mute/unmute the speakers

All states are polled from the speaker and kept in sync with HomeKit.

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
npm run build
npm link
```

Then restart Homebridge to load the plugin.
