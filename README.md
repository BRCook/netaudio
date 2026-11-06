# NetAudio — unofficial Dante Controller alternative

> [!NOTE]
> This is a fork of Chris Ritsen's [network-audio-controller](https://github.com/chris-ritsen/network-audio-controller), maintained for use with [Virgil](https://github.com/BRCook/dante-virgil) and [Headhunter](https://github.com/BRCook/wing-headhunter). It adds multicast flow support for Dante devices using ARC protocol 2.8.12 and a PTPv2 clock setting. Please report problems with these additions here rather than to Chris.

NetAudio discovers, routes, configures and monitors Dante network audio devices without Dante Controller. It provides a command-line interface, a web interface served by a background daemon, an HTTP API with live events, and a Rust protocol library.

## What this fork adds

| Change | Where |
| --- | --- |
| Create, read back and delete native multicast transmit flows on devices using ARC protocol 2.8.12 (0x280C) | CLI and web UI |
| Switch a device's PTPv2 multicast clock port on or off without enabling AES67 mode | CLI (`device config ptpv2`) and web UI (Clocking panel) |
| Ask newly found devices for their encoding when it is not otherwise known, so flow plans no longer report an unknown audio format | Daemon |
| Keep clock status fresh while the Clocking panel is open, for devices that only report it when asked | Web UI |
| Offer AES67 configuration on devices that list the AES67 setting but do not report their capabilities, and read their lock state so settings can be changed | Daemon |
| Let CLI status readbacks (clock, sample rate, encoding, lock) work while the daemon is running | CLI |
| Remove the iOS and iPadOS app packaging | Repository |

The flow changes apply only to devices advertising protocol 0x280C, and the PTPv2 setting is only offered where the device's clock status reports support for it. Other devices behave as they do upstream.

## Installation

This fork is installed as part of Virgil and Headhunter and is not published to PyPI.

> [!WARNING]
> `uv tool install netaudio`, `pip install netaudio`, the AUR package and the `s00pcan/netaudio` container all install the **original** netaudio, not this one!

## Quick start

Start the daemon and open the web interface:

```bash
netaudio daemon start
netaudio daemon web --open
```

Use `netaudio --help` for the command list and `netaudio COMMAND --help` for individual commands.

Select devices with filters placed before the command: `-n` matches names (including quoted patterns such as `'stage-*'`), `-s` matches server names, `-m` matches MAC addresses, and `--host` selects an IP address. Add `--json` for structured output:

```bash
netaudio -n console device show
netaudio --json -n console device show
```

Commands that change a device send the change and return. Add `--verify` before the command to wait until a fresh readback confirms it.

### Channels and routing

Channels use `tx:NUMBER` or `rx:NUMBER`; a channel name can replace the number. For example, rename input 1 of `stagebox` and connect output 1 of `console` to it:

```bash
netaudio -n stagebox channel name rx:1 vocal-in
netaudio subscription add --tx tx:1@console --rx rx:1@stagebox
netaudio subscription remove --rx rx:1@stagebox
```

### Multicast flows

Describe the flow in a JSON file. Devices using ARC 2.8.12 identify flows by a media-local identifier, which Dante Controller numbers downward from 32:

```json
{
  "schema_version": 1,
  "media_mode": "native_dante",
  "flow_type": "multicast",
  "identity": { "media_local_flow_id": 32 },
  "channel_slots": [
    { "slot": 1, "transmitter_channel": 1 },
    { "slot": 2, "transmitter_channel": 2 }
  ]
}
```

Check the plan, which sends nothing to the device, then create, list and delete the flow:

```bash
netaudio -n console flow plan flow.json
netaudio -n console flow apply flow.json --yes
netaudio -n console flow inspect
netaudio -n console flow delete --slot 32 --yes
```

The web interface offers the same in the device's transmit flows section, where the new-flow form asks for a media-local flow identifier on these devices.

### PTPv2 without AES67

```bash
netaudio -n console device config ptpv2
netaudio -n console device config ptpv2 on
netaudio -n console device config ptpv2 off
```

Each change is confirmed by reading the clock status back. In the web interface, use **PTPv2 multicast** in the device's Clocking panel.

> [!IMPORTANT]
> Some devices do not keep this setting when their Dante interface restarts. Switch it on again after a reboot.

### Presets

Save selected devices, then preview the saved settings before applying them:

```bash
netaudio -n 'stage-*' preset save stage
netaudio preset show stage
netaudio preset load stage
```

`preset show` reads current device state but makes no changes. Presets are XML files in `presets/` beside the configuration file; use `preset list` to see them, or supply an explicit `.xml` path. Saving over an existing file requires `--force`.

## Configuration

`netaudio config path` shows which configuration file is used. Restart the daemon after changing it.

The daemon serves HTTPS on port 4781 with a self-signed certificate that it creates and renews automatically. Plain HTTP on port 4780 stays available on loopback for the local CLI and browser; `netaudio daemon web` lists the addresses. To use your own certificate or other ports:

```toml
[daemon]
tls_certificate = "/path/to/certificate.pem"
tls_key = "/path/to/private-key.pem"
tls_port = 4781
port = 4780
```

To serve plain HTTP on the network instead, set `no_ssl = true` under `[daemon]`.

For a Dante Domain Manager network, `netaudio ddm login --default` guides you through connecting to a server and choosing a domain.

### Firewall

Allow these UDP ports from the Dante network: 4440, 4444, 4455, 5353, 8700–8708, 8751 and 8800. Also allow the HTTPS port (4781 by default) from any computer that opens the web interface.

## Troubleshooting

Use `netaudio daemon status` to check the daemon and `netaudio daemon logs -f` to follow its logs. Logs default to warnings and errors. For detailed logging, stop the background daemon and run it in the foreground:

```bash
netaudio daemon stop
netaudio --log-level DEBUG daemon run
```

The browser's Events page keeps recent events and issues in memory, and restarting the daemon clears them. Save them first with `netaudio events export --file events.json`.

## Background

NetAudio is an independent interoperability project and is not affiliated with or endorsed by Audinate. It grew out of packet capture replay and modification experiments first written up in a [Gearspace discussion](https://gearspace.com/board/music-computers/1221989-dante-routing-without-dante-controller-possible.html). The original project is by Chris Ritsen. This fork's additions were developed and tested against a Behringer WING Compact with Dante firmware 4.2.9.4.

The original NetAudio is released into the public domain under the Unlicense ([LICENSE-UPSTREAM](LICENSE-UPSTREAM)). This fork, like Virgil and Headhunter, is released under the GNU Affero General Public License version 3 or later; see [LICENSE](LICENSE).