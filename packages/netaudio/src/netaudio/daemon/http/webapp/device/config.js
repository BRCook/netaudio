import { DeviceControls } from "./controls.js";
import { performanceOperationWritable } from "./availability.js";
import { sampleRatePullupChoices } from "../core-metadata.js";
import { api } from "../api.js";
import { AsyncButton, FieldRow, Panel } from "../components.js";
import * as format from "../format.js";
import { t } from "../i18n.js";
import { html, useRef, useState } from "../lib/preact.js";
import { deviceRequestName, recordDeviceRename } from "../store.js";
import {
  operationWritable,
} from "./availability.js";
import { useClockRefresh } from "./clock-refresh.js";
import { isEnrolled } from "./managed.js";

function RenameControl({ device, requestName }) {
  const input = useRef(null);
  return html`
    <${FieldRow} label=${t("Device name")}>
      <input
        key=${`rename-${requestName}`}
        ref=${input}
        type="text"
        size="28"
        aria-label=${t("Device name")}
        defaultValue=${device.name}
      />
      <${AsyncButton}
        variant="primary"
        small
        description=${device.name ? t("rename {device}", { device: device.name }) : t("rename device")}
        onRun=${() => {
          recordDeviceRename(device.name, device);
          return api.renameDevice(requestName, input.current.value);
        }}
      >
        ${t("Apply")}
      <//>
    <//>
  `;
}

function SampleRateControl({ device, requestName }) {
  const select = useRef(null);
  const [pending, setPending] = useState(null);
  const supported = device.supported_sample_rates_hz || [];
  const writable = operationWritable(device, "sample_rate");
  const apply = async () => {
    setPending(null);
    const rate = Number(select.current.value);
    try {
      return await api.setSampleRate(requestName, rate, false);
    } catch (error) {
      const preflight = error.payload?.preflight;
      if (
        error.status !== 409 ||
        preflight?.requires_destructive_confirmation !== true ||
        preflight?.is_classified !== true ||
        preflight?.topology_characterized !== true ||
        preflight?.target_sample_rate_hertz !== rate
      )
        throw error;
      setPending({
        requestName,
        rate,
        losses: preflight.destructive_transmitter_membership_loss,
      });
    }
  };
  if (!writable || !supported.length) {
    if (device.sample_rate_hz == null) return null;
    return html`<${FieldRow} label=${t("Sample rate")}>
      <span>${format.sampleRate(device.sample_rate_hz)}</span>
    <//>`;
  }
  return html`
    <${FieldRow} label=${t("Sample rate")}>
      <select
        key=${`sample-rate-${requestName}`}
        ref=${select}
        aria-label=${t("Sample rate")}
        onChange=${() => setPending(null)}
      >
        ${supported.map(
          (value) =>
            html`<option
              key=${value}
              value=${value}
              selected=${Number(value) === Number(device.sample_rate_hz)}
            >
              ${format.sampleRate(value)}
            </option>`,
        )}
      </select>
      <${AsyncButton}
        variant="primary"
        small
        description=${device.name ? t("set sample rate on {device}", { device: device.name }) : t("set sample rate on device")}
        onRun=${apply}
      >
        ${t("Apply")}
      <//>
      ${
        pending?.requestName === requestName
          ? html`
              <div class="flex flex-col gap-2" role="alert">
                <span
                  >${t("Changing to {rate} removes these transmitter channels from existing flows:", { rate: format.sampleRate(pending.rate) })}</span
                >
                <ul>
                  ${pending.losses.map((loss) => html`<li>${t("Flow {flow}: channels {channels}", { flow: loss.flow_number, channels: loss.removed_channel_members.join(", ") })}</li>`)}
                </ul>
                <${AsyncButton}
                  small
                  variant="danger"
                  description=${device.name ? t("change sample rate and remove flow channels on {device}", { device: device.name }) : t("change sample rate and remove flow channels on device")}
                  onRun=${async () => {
                    const result = await api.setSampleRate(
                      requestName,
                      pending.rate,
                      true,
                    );
                    setPending(null);
                    return result;
                  }}
                  >${t("Change rate and remove channels")}<//
                >
                <button
                  type="button"
                  class="btn btn-sm"
                  onClick=${() => setPending(null)}
                >
                  ${t("Cancel")}
                <//>
              </div>
            `
          : null
      }
    <//>
  `;
}

function EncodingControl({ device, requestName }) {
  const select = useRef(null);
  const supported = device.supported_encodings || [];
  const writable = operationWritable(device, "encoding");
  if (!writable || !supported.length) {
    if (!device.encoding) return null;
    return html`<${FieldRow} label=${t("Encoding")}>
      <span>PCM ${device.encoding}</span>
    <//>`;
  }
  return html`
    <${FieldRow} label=${t("Encoding")}>
      <select
        key=${`encoding-${requestName}`}
        ref=${select}
        aria-label=${t("Encoding")}
      >
        ${supported.map(
          (value) =>
            html`<option
              key=${value}
              value=${value}
              selected=${Number(value) === Number(device.encoding)}
            >
              PCM ${value}
            </option>`,
        )}
      </select>
      <${AsyncButton}
        variant="primary"
        small
        description=${device.name ? t("set encoding on {device}", { device: device.name }) : t("set encoding on device")}
        onRun=${() => api.setEncoding(requestName, Number(select.current.value))}
      >
        ${t("Apply")}
      <//>
    <//>
  `;
}

function PullupControl({ device, requestName }) {
  const select = useRef(null);
  const labels = new Map(
    sampleRatePullupChoices.map(({ value, label }) => [
      value,
      t(label.charAt(0).toUpperCase() + label.slice(1)),
    ]),
  );
  const supported = (
    device.supported_sample_rate_pullup_raw_values || []
  ).filter((value) => labels.has(value));
  const writable = operationWritable(device, "sample_rate_pullup");
  if (!writable || !supported.length) {
    const current = labels.get(Number(device.sample_rate_pullup_raw_value));
    if (!current) return null;
    return html`<${FieldRow} label=${t("Sample rate pull-up")}>
      <span>${current}</span>
    <//>`;
  }
  return html`
    <${FieldRow} label=${t("Sample rate pull-up")}>
      <select key=${`pullup-${requestName}`} ref=${select}>
        ${supported.map(
          (value) =>
            html`<option
              key=${value}
              value=${value}
              selected=${Number(value) === Number(device.sample_rate_pullup_raw_value)}
            >
              ${labels.get(value)}
            </option>`,
        )}
      </select>
      <${AsyncButton}
        variant="primary"
        small
        description=${device.name ? t("set sample rate pull-up on {device}", { device: device.name }) : t("set sample rate pull-up on device")}
        onRun=${() => api.setSampleRatePullup(requestName, Number(select.current.value))}
      >
        ${t("Apply")}
      <//>
    <//>
  `;
}

const EXTENDED_CLOCK_FIELDS = [
  ["follower_only", t("Follower only"), null],
  ["ptpv2_domain", t("PTPv2 domain"), 255],
  ["ptpv2_priority1", t("PTPv2 priority 1"), 255],
  ["ptpv2_priority2", t("PTPv2 priority 2"), 255],
  ["multicast_dscp", t("Multicast DSCP"), 63],
];

const PORT_CLOCK_FIELDS = [
  ["ttl", t("Multicast TTL"), 0, 255],
  ["sync_interval", t("Sync interval (log seconds)"), -128, 127],
  ["announce_interval", t("Announce interval (log seconds)"), -128, 127],
  ["delay_request_interval", t("Delay-request interval (log seconds)"), -128, 127],
  ["peer_delay_interval", t("Peer-delay interval (log seconds)"), -128, 127],
];

// The aggregate PTPv1 unicast setting, or, when the device reports none (the
// WING leaves it unset because its disabled unicast port has no value), the
// value every PTPv1 port that reports one agrees on.
function ptpv1UnicastCurrent(clock) {
  if (typeof clock?.aggregate_ptpv1_unicast_delay_requests === "boolean")
    return clock.aggregate_ptpv1_unicast_delay_requests;
  const values = (clock?.clock_port_records || [])
    .filter((port) => port.ptp_version === 1 && typeof port.unicast_delay_requests === "boolean")
    .map((port) => port.unicast_delay_requests);
  return values.length && values.every((value) => value === values[0]) ? values[0] : null;
}

// The first option keeps the device's setting. When that setting is known it is
// shown there ("On (current)"), and only the other value is offered as a change.
function OnOffSelect({ reference, onChange, label, current }) {
  const known = typeof current === "boolean";
  return html`<select ref=${reference} aria-label=${label} onChange=${onChange}>
    <option value="keep">${known ? t("{value} (current)", { value: current ? t("On") : t("Off") }) : t("Keep current setting")}</option>
    ${known && current ? null : html`<option value="true">${t("On")}</option>`}
    ${known && !current ? null : html`<option value="false">${t("Off")}</option>`}
  </select>`;
}

function ClockingControls({ device, requestName }) {
  const preferred = useRef(null);
  const source = useRef(null);
  const subdomain = useRef(null);
  const unicast = useRef(null);
  const ptpv2 = useRef(null);
  const ptpv2Unicast = useRef(null);
  const [extended, setExtended] = useState({});
  const [portChanges, setPortChanges] = useState({});
  const allowed = device.clock_control_availability || {};
  const fresh = format.clockStatusFresh(device);
  const managed = isEnrolled(device);
  useClockRefresh(device, requestName);
  if (managed) {
    return html`<${Panel} title=${t("Clocking")}>
      <${FieldRow} label=${t("Preferred leader")}>
        <${AsyncButton}
          small
          description=${device.name ? t("prefer {device} as clock leader", { device: device.name }) : t("prefer device as clock leader")}
          onRun=${() => api.setPreferredLeader(requestName, true)}
          >${t("On")}<//
        >
        <${AsyncButton}
          small
          description=${device.name ? t("clear the clock leader preference on {device}", { device: device.name }) : t("clear the clock leader preference on device")}
          onRun=${() => api.setPreferredLeader(requestName, false)}
          >${t("Off")}<//
        >
      <//>
    <//>`;
  }
  if (!fresh) return null;
  const sourceChoices = device.clock_source_choices || [];
  const preferredAllowed = allowed.preferred_leader === true;
  const sourceAllowed = allowed.clock_source === true && sourceChoices.length > 0;
  const currentSource = sourceChoices.find((choice) => choice.code === device.clock_source_code);
  const named = allowed.subdomain === true;
  const perPort = allowed.aggregate_ptpv1_unicast_delay_requests === true;
  const unicastAllowed = perPort || allowed.global_unicast_delay_requests === true;
  const ptpv2Allowed = allowed.ptpv2_enabled === true && device.clock_status?.ptpv2_enabled != null;
  const ptpv2UnicastAllowed = allowed.aggregate_ptpv2_unicast_delay_requests === true
    && typeof device.clock_status?.aggregate_ptpv2_unicast_delay_requests === "boolean";
  const extendedFields = EXTENDED_CLOCK_FIELDS.filter(
    ([name]) => allowed[name] === true && device.clock_status?.[name] != null,
  );
  const ports = allowed.ports === true
    ? (device.clock_status?.extended_ports || []).filter((port) => port.port_id >= 1 && port.port_id <= 64)
    : [];
  if (!preferredAllowed && !sourceAllowed && !named && !unicastAllowed && !ptpv2Allowed && !ptpv2UnicastAllowed && !extendedFields.length && !ports.length) {
    return null;
  }
  const apply = async () => {
    const changes = Object.fromEntries(Object.entries(extended).filter(([name]) => allowed[name] === true));
    if (ports.length) {
      const changedPorts = Object.entries(portChanges).map(([port_id, fields]) => ({
        port_id: Number(port_id),
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null)),
      })).filter((port) => Object.keys(port).length > 1);
      if (changedPorts.length) changes.ports = changedPorts;
    }
    if (preferredAllowed && preferred.current?.value !== "keep")
      changes.preferred_leader = preferred.current.value === "true";
    if (sourceAllowed && source.current?.value !== "keep")
      changes.clock_source = Number(source.current.value);
    const currentSubdomain = device.clock_subdomain_presentation?.text ?? "";
    if (named && subdomain.current && subdomain.current.value !== currentSubdomain)
      changes.subdomain = subdomain.current.value;
    if (unicastAllowed && unicast.current?.value !== "keep")
      changes[
        perPort
          ? "aggregate_ptpv1_unicast_delay_requests"
          : "global_unicast_delay_requests"
      ] = unicast.current.value === "true";
    if (ptpv2Allowed && ptpv2.current?.value !== "keep")
      changes.ptpv2_enabled = ptpv2.current.value === "true";
    if (ptpv2UnicastAllowed && ptpv2Unicast.current?.value !== "keep")
      changes.aggregate_ptpv2_unicast_delay_requests = ptpv2Unicast.current.value === "true";
    return api.setClockConfiguration(requestName, changes);
  };
  return html`
    <${Panel} title=${t("Clocking")}>
      ${preferredAllowed ? html`<${FieldRow} label=${t("Preferred leader")}><${OnOffSelect} reference=${preferred} label=${t("Preferred leader")} current=${device.clock_status?.preferred_leader ?? device.preferred_leader} /><//>` : null}
      ${sourceAllowed ? html`<${FieldRow} label=${t("Clock source")}>
        <select ref=${source} aria-label=${t("Clock source")}>
          ${currentSource
            ? html`<option value="keep">${t("{value} (current)", { value: format.stateLabel(currentSource.label) })}</option>`
            : html`<option value="keep">${t("Keep current setting")}</option>`}
          ${sourceChoices.filter((choice) => choice !== currentSource).map((choice) => html`<option value=${choice.code}>${format.stateLabel(choice.label)}</option>`)}
        </select>
      <//>` : null}
      ${named ? html`<${FieldRow} label=${t("Clock subdomain")}>
        <input ref=${subdomain} aria-label=${t("Clock subdomain")} defaultValue=${device.clock_subdomain_presentation?.text ?? ""} />
      <//>` : null}
      ${unicastAllowed ? html`<${FieldRow} label=${perPort ? t("PTPv1 unicast delay requests") : t("Unicast delay requests")}>
        <${OnOffSelect} reference=${unicast} label=${perPort ? t("PTPv1 unicast delay requests") : t("Unicast delay requests")}
          current=${perPort ? ptpv1UnicastCurrent(device.clock_status) : device.clock_status?.global_unicast_delay_requests} />
      <//>` : null}
      ${ptpv2Allowed ? html`<${FieldRow} label=${t("PTPv2 multicast")}>
        <${OnOffSelect} reference=${ptpv2} label=${t("PTPv2 multicast")} current=${device.clock_status.ptpv2_enabled} />
      <//>` : null}
      ${ptpv2UnicastAllowed ? html`<${FieldRow} label=${t("PTPv2 unicast delay requests")}>
        <${OnOffSelect} reference=${ptpv2Unicast} label=${t("PTPv2 unicast delay requests")}
          current=${device.clock_status.aggregate_ptpv2_unicast_delay_requests} />
      <//>` : null}
      ${extendedFields.length || ports.length ? html`<details><summary>${t("Advanced clock settings")}</summary>
        ${extendedFields.map(([name, label, maximum]) => html`<${FieldRow} label=${label}>
          ${maximum == null
            ? html`<${OnOffSelect} label=${label} current=${device.clock_status[name]} onChange=${(event) => setExtended({ ...extended, [name]: event.target.value === "keep" ? null : event.target.value === "true" })} />`
            : html`<input type="number" aria-label=${label} min="0" max=${maximum} step="1" defaultValue=${device.clock_status[name]}
                onChange=${(event) => setExtended({ ...extended, [name]: event.target.value === "" ? null : Number(event.target.value) })} />`}
        <//>`)}
        ${ports.map((port) => html`
          <fieldset><legend>${t("Port {port}", { port: port.port_id })}</legend>
            ${PORT_CLOCK_FIELDS.filter(([name]) => port[name] != null).map(([name, label, minimum, maximum]) => html`
              <${FieldRow} label=${label}><input type="number" aria-label=${t("Port {port} {setting}", { port: port.port_id, setting: label })} min=${minimum} max=${maximum} step="1" defaultValue=${port[name]}
                onChange=${(event) => setPortChanges({ ...portChanges, [port.port_id]: {
                  ...portChanges[port.port_id], [name]: event.target.value === "" ? null : Number(event.target.value),
                } })} /><//>`)}
            ${port.follower_only != null ? html`<${FieldRow} label=${t("Follower only")}><${OnOffSelect}
              label=${t("Port {port} follower only", { port: port.port_id })}
              current=${port.follower_only}
              onChange=${(event) => setPortChanges({ ...portChanges, [port.port_id]: {
                ...portChanges[port.port_id], follower_only: event.target.value === "keep" ? null : event.target.value === "true",
              } })} /><//>` : null}
          </fieldset>`)}
      </details>` : null}
      <${AsyncButton}
        variant="primary"
        small
        description=${device.name ? t("apply clock settings on {device}", { device: device.name }) : t("apply clock settings on device")}
        onRun=${apply}
        >${t("Apply clock settings")}<//
      >
    <//>
  `;
}


export function DeviceConfigSection({ device }) {
  const requestName = deviceRequestName(device);
  const identifyWritable = operationWritable(device, "identify");
  return html`
    <div class="flex flex-col gap-4">
      <${Panel}
        title=${t("Device config")}
        headerActions=${html`
          <${AsyncButton}
            small
            description=${device.name ? t("refresh settings for {device}", { device: device.name }) : t("refresh settings for device")}
            onRun=${() => api.refresh(requestName)}
            >${t("Refresh settings")}<//
          >
          ${
            identifyWritable
              ? html`<${AsyncButton}
                  small
                  description=${device.name ? t("identify {device}", { device: device.name }) : t("identify device")}
                  onRun=${() => api.identify(requestName)}
                  >${t("Identify")}<//
                >`
              : null
          }
          <${AsyncButton}
            small
            variant="danger"
            description=${device.name ? t("reboot {device}", { device: device.name }) : t("reboot device")}
            onRun=${() => api.reboot(requestName)}
            >${t("Reboot")}<//
          >
        `}
      >
        <${RenameControl} device=${device} requestName=${requestName} />
        <${SampleRateControl} device=${device} requestName=${requestName} />
        <${EncodingControl} device=${device} requestName=${requestName} />
        <${LatencyControl} device=${device} />
        <${PullupControl} device=${device} requestName=${requestName} />
      <//>
      <${ClockingControls} device=${device} requestName=${requestName} />
      <${PerformanceControls} device=${device} requestName=${requestName} />
      <${DeviceControls} device=${device} />
    </div>
  `;
}

const PERFORMANCE_FRAMES_PER_PACKET = [2, 4, 6, 8, 12, 16, 24, 32, 48, 64];

// Each setting is a latency and frames per packet pair, stored on the device as
// properties: transmit flows 0x8204 (ns) / 0x0210, unicast flows 0x8205 / 0x0211.
const PERFORMANCE_SETTINGS = [
  {
    operation: "transmit_flow_performance",
    label: "Multicast flows",
    latencyProperty: "33284",
    framesProperty: "528",
    apply: (device, latency, frames) => api.setTransmitFlowPerformance(device, latency, frames),
  },
  {
    operation: "unicast_performance",
    label: "Unicast flows",
    latencyProperty: "33285",
    framesProperty: "529",
    apply: (device, latency, frames) => api.setUnicastPerformance(device, latency, frames),
  },
];

function PerformanceControls({ device, requestName }) {
  const settings = PERFORMANCE_SETTINGS.filter((setting) => performanceOperationWritable(device, setting.operation));
  if (!settings.length) return null;
  return html`
    <${Panel} title=${t("Flow performance")}>
      ${settings.map((setting) => html`<${PerformanceSetting}
        key=${setting.operation}
        device=${device}
        requestName=${requestName}
        setting=${setting}
      />`)}
      <p class="text-sm opacity-70">${t("New flows use these settings; existing flows keep theirs until they are re-created or re-subscribed.")}</p>
    <//>
  `;
}

function PerformanceSetting({ device, requestName, setting }) {
  const latency = useRef(null);
  const frames = useRef(null);
  const stored = device.performance_settings || {};
  const currentLatency = Number.isFinite(stored[setting.latencyProperty]) ? stored[setting.latencyProperty] / 1000000 : null;
  const currentFrames = Number.isFinite(stored[setting.framesProperty]) ? stored[setting.framesProperty] : null;
  const latencies = [...new Set([
    ...(device.standard_latency_choices_ms || []).map(Number),
    ...(currentLatency === null ? [] : [currentLatency]),
  ])].sort((first, second) => first - second);
  const frameChoices = [...new Set([
    ...PERFORMANCE_FRAMES_PER_PACKET,
    ...(currentFrames === null ? [] : [currentFrames]),
  ])].sort((first, second) => first - second);
  const label = (value, current, text) => (value === current ? t("{value} (current)", { value: text }) : text);
  const apply = () => {
    const latencyMilliseconds = Number(latency.current?.value);
    const framesPerPacket = Number(frames.current?.value);
    if (!Number.isFinite(latencyMilliseconds) || !Number.isInteger(framesPerPacket)) {
      throw new Error(t("Choose a latency and frames per packet."));
    }
    return setting.apply(requestName, Math.round(latencyMilliseconds * 1000), framesPerPacket);
  };
  return html`
    <${FieldRow} label=${t(setting.label)}>
      <select ref=${latency} aria-label=${t("{setting} latency", { setting: t(setting.label) })}>
        ${currentLatency === null ? html`<option value="">${t("Latency")}</option>` : null}
        ${latencies.map((value) => html`<option key=${value} value=${value} selected=${value === currentLatency}>
          ${label(value, currentLatency, `${value} ms`)}
        </option>`)}
      </select>
      <select ref=${frames} aria-label=${t("{setting} frames per packet", { setting: t(setting.label) })}>
        ${currentFrames === null ? html`<option value="">${t("Frames per packet")}</option>` : null}
        ${frameChoices.map((value) => html`<option key=${value} value=${value} selected=${value === currentFrames}>
          ${label(value, currentFrames, t("{count} frames", { count: value }))}
        </option>`)}
      </select>
      <${AsyncButton}
        variant="primary"
        small
        description=${t("apply {setting} performance on {device}", { setting: t(setting.label), device: device.name || requestName })}
        onRun=${apply}
        >${t("Apply")}<//>
    <//>
    ${setting.operation === "transmit_flow_performance" && device.manufacturer === "Behringer"
      ? html`<p class="text-sm opacity-70">${t("WING consoles don't create multicast flows at 64 frames per packet, and keep transmit latency at 5 ms or more.")}</p>`
      : null}
  `;
}

function LatencyControl({ device }) {
  const requestName = deviceRequestName(device);
  const control = useRef(null);
  const customInput = useRef(null);
  const [custom, setCustom] = useState(false);
  const minimum = device.min_latency_ms;
  const maximum = device.max_latency_ms;
  const hasRange =
    Number.isFinite(minimum) &&
    Number.isFinite(maximum) &&
    minimum >= 0 &&
    maximum >= minimum;
  const values = new Set(
    (device.standard_latency_choices_ms || []).map(Number),
  );
  for (const candidate of [
    device.latency_ms,
    device.configured_latency_ms,
    device.default_latency_ms,
  ]) {
    if (candidate !== null && candidate !== undefined) {
      values.add(Number(candidate));
    }
  }
  const choices = [...values].sort((first, second) => first - second);
  const current = device.configured_latency_ms ?? device.latency_ms;
  if (!choices.length && !hasRange) return null;
  return html`
    <${FieldRow} label=${t("Latency")}>
      ${
        choices.length
          ? html`<select
              key=${`latency-${requestName}`}
              ref=${control}
              aria-label=${t("Latency")}
              onChange=${(event) => setCustom(event.currentTarget.value === "custom")}
            >
              ${choices.map(
                (value) =>
                  html`<option
                    key=${value}
                    value=${value}
                    selected=${Number(value) === Number(current)}
                  >
                    ${value} ms
                  </option>`,
              )}
              ${hasRange ? html`<option value="custom">${t("Custom…")}</option>` : null}
            </select>`
          : null
      }
      ${
        custom || !choices.length
          ? html`
              <input
                key=${`custom-latency-${requestName}`}
                ref=${customInput}
                aria-label=${t("Custom latency in milliseconds")}
                type="number"
                min=${minimum}
                max=${maximum}
                step="any"
                required
                defaultValue=${current ?? minimum}
              />
              <span>ms (${minimum}–${maximum})</span>
            `
          : null
      }
      <${AsyncButton}
        variant="primary"
        small
        description=${device.name ? t("set latency on {device}", { device: device.name }) : t("set latency on device")}
        onRun=${() => {
          const input =
            custom || !choices.length ? customInput.current : control.current;
          if (!input.checkValidity())
            throw new Error(t("Enter a latency from {minimum} to {maximum} ms", { minimum, maximum }));
          return api.setLatency(requestName, Number(input.value));
        }}
      >
        ${t("Apply")}
      <//>
    <//>
  `;
}
