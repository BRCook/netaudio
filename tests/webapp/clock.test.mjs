import assert from "node:assert/strict";
import { test } from "node:test";
import { WEBAPP, fixture } from "./setup.mjs";
const { h } = await import("preact");
const { render } = await import("preact-render-to-string");
const { StatusSection } = await import(`${WEBAPP}device/status.js`);
const { DeviceConfigSection } = await import(`${WEBAPP}device/config.js`);
const { clockLeaderName } = await import(`${WEBAPP}format.js`);

function device() {
  return {
    ...Object.values(fixture("devices"))[0],
    management_state: "unmanaged",
    ddm_enrolled: false,
    online: true,
    clock_observed_at: new Date().toISOString(),
    clock_status: {
      status_supported: true,
      synchronization: "lost",
      servo_state_code: 2,
      servo_state: "synchronizing",
      mute_flags: 3,
      mute_state: "muted",
      mute_reasons: ["synchronization loss", "external-clock problem"],
      clock_capabilities: 0x204,
      preferred_leader_locked: true,
      clock_port_records: [
        {
          record_number: 1,
          ptp_version: 1,
          state: "follower",
          state_code: 9,
          transport_path: "multicast",
          network_interface_index: null,
          link_down: null,
          user_disabled: null,
          unicast_delay_requests: null,
        },
      ],
    },
    ptpv1_device_uuid: "010203040506",
    ptpv1_master_uuid: "0708090a0b0c",
    ptpv1_grandmaster_uuid: "0d0e0f101112",
  };
}

test("extended clock controls require fresh native availability and readback", () => {
  const value = device();
  value.clock_status.ptpv2_priority1 = 128;
  value.clock_status.multicast_dscp = 46;
  value.clock_control_availability = { ptpv2_priority1: true, multicast_dscp: false };
  let form = render(h(DeviceConfigSection, { device: value }));
  assert.match(form, /PTPv2 priority 1/);
  assert.doesNotMatch(form, /Multicast DSCP/);
  assert.doesNotMatch(form, /Enable PTPv[12]/);
  value.clock_observed_at = "2000-01-01T00:00:00Z";
  form = render(h(DeviceConfigSection, { device: value }));
  assert.doesNotMatch(form, /PTPv2 priority 1/);
});

test("the PTPv2 multicast control needs native availability and port readback", () => {
  const value = device();
  value.clock_status.ptpv2_enabled = false;
  value.clock_control_availability = { ptpv2_enabled: true };
  let form = render(h(DeviceConfigSection, { device: value }));
  assert.match(form, /PTPv2 multicast[^]*?<select(?![^>]*disabled)/);
  assert.match(form, /Off \(current\)/);
  assert.doesNotMatch(form, /PTPv2 multicast[^]*?<option value="false">/);
  value.clock_control_availability = { ptpv2_enabled: false };
  form = render(h(DeviceConfigSection, { device: value }));
  assert.doesNotMatch(form, /PTPv2 multicast/);
  value.clock_control_availability = { ptpv2_enabled: true };
  value.clock_status.ptpv2_enabled = null;
  form = render(h(DeviceConfigSection, { device: value }));
  assert.doesNotMatch(form, /PTPv2 multicast/);
});

test("the PTPv1 unicast selector shows the value its ports agree on", () => {
  const value = device();
  value.clock_control_availability = { aggregate_ptpv1_unicast_delay_requests: true };
  value.clock_status.aggregate_ptpv1_unicast_delay_requests = null;
  value.clock_status.clock_port_records = [
    { record_number: 1, ptp_version: 1, transport_path: "multicast", unicast_delay_requests: false },
    { record_number: 3, ptp_version: 1, transport_path: "unicast", unicast_delay_requests: null },
  ];
  let form = render(h(DeviceConfigSection, { device: value }));
  assert.match(form, /PTPv1 unicast delay requests[^]*?Off \(current\)/);
  value.clock_status.clock_port_records[1].unicast_delay_requests = true;
  form = render(h(DeviceConfigSection, { device: value }));
  assert.match(form, /PTPv1 unicast delay requests[^]*?Keep current setting/);
});

test("the PTPv2 unicast selector needs availability and a reported value", () => {
  const value = device();
  value.clock_control_availability = { aggregate_ptpv2_unicast_delay_requests: true };
  value.clock_status.aggregate_ptpv2_unicast_delay_requests = false;
  let form = render(h(DeviceConfigSection, { device: value }));
  assert.match(form, /PTPv2 unicast delay requests[^]*?Off \(current\)/);
  value.clock_status.aggregate_ptpv2_unicast_delay_requests = null;
  form = render(h(DeviceConfigSection, { device: value }));
  assert.doesNotMatch(form, /PTPv2 unicast delay requests/);
});

test("clock freshness follows the daemon's verdict when the browser clock disagrees", () => {
  const value = device();
  value.clock_control_availability = { ptpv2_enabled: true };
  value.clock_status.ptpv2_enabled = true;
  value.clock_observed_at = new Date(Date.now() - 60000).toISOString();
  value.clock_status.observation_state = "fresh";
  assert.match(render(h(DeviceConfigSection, { device: value })), /PTPv2 multicast/);
  value.clock_observed_at = new Date().toISOString();
  value.clock_status.observation_state = "stale";
  assert.doesNotMatch(render(h(DeviceConfigSection, { device: value })), /PTPv2 multicast/);
});

test("clock details show mute reasons", () => {
  const html = render(h(StatusSection, { device: device() }));
  assert.ok(html.includes("external-clock problem"));
});

test("stale clock status is unavailable and disables direct configuration", () => {
  const stale = { ...device(), clock_observed_at: "2000-01-01T00:00:00Z" };
  const form = render(h(DeviceConfigSection, { device: stale }));
  assert.doesNotMatch(form, /Apply clock settings/);
});

test("a MAC address cannot substitute for a reported PTPv1 UUID", () => {
  const clock = device();
  const candidate = { name: "Unrelated", mac_address: clock.ptpv1_master_uuid };
  assert.notEqual(clockLeaderName(clock, { candidate }), "Unrelated");
});

test("clock controls use native permissions, not raw capability guesses", () => {
  const value = device();
  value.clock_status.clock_capabilities = 0;
  value.clock_status.record_revision = 0;
  value.clock_control_availability = {
    preferred_leader: true,
    clock_source: true,
    subdomain: false,
    global_unicast_delay_requests: false,
    aggregate_ptpv1_unicast_delay_requests: true,
  };
  const form = render(h(DeviceConfigSection, { device: value }));
  assert.match(form, /Preferred leader[^]*?<select(?![^>]*disabled)/);
  value.clock_control_availability.preferred_leader = false;
  value.clock_status.clock_capabilities = 4;
  value.clock_status.record_revision = 0x072d;
  assert.doesNotMatch(
    render(h(DeviceConfigSection, { device: value })),
    /Preferred leader/,
  );
});
