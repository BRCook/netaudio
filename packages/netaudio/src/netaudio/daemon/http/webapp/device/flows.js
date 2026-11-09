import { api } from "../api.js";
import { AsyncButton, Panel } from "../components.js";
import * as format from "../format.js";
import { t } from "../i18n.js";
import { html, useEffect, useState } from "../lib/preact.js";
import { deviceRequestName } from "../store.js";

// Accepts channel numbers and inclusive ranges, such as "1-64" or "1-8,17,20".
function parseChannels(text) {
  const values = [];
  for (const part of String(text).split(",")) {
    const bounds = part.split("-").map((value) => value.trim());
    const [first, last] = [Number(bounds[0]), Number(bounds[bounds.length - 1])];
    const valid = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;
    if (bounds.length > 2 || bounds.some((value) => value === "") || !valid(first) || !valid(last) || last < first) {
      values.length = 0;
      break;
    }
    for (let channel = first; channel <= last; channel += 1) values.push(channel);
  }
  if (!values.length) {
    throw new Error(t("Enter transmitter channel numbers or ranges, such as 1-64 or 1,2,5."));
  }
  return values;
}

// How many channels the Channels field describes, or null while it is invalid.
export function channelCount(text) {
  try {
    return parseChannels(text).length;
  } catch {
    return null;
  }
}

export function flowIdentifierMaximum(authoring, maximumFlows) {
  if (authoring?.identity_field === "global_flow_id" && Number.isInteger(maximumFlows) && maximumFlows > 0) {
    return Math.min(authoring.identifier_max, maximumFlows);
  }
  return authoring?.identifier_max;
}

export function canonicalFlowRequest({
  authoring,
  channels,
  encoding,
  flowId,
  flowName = "",
  framesPerPacket = "",
  maximumFlows = null,
  mediaMode = "native_dante",
  primaryAddress = "",
  primaryPort = "",
  sampleRate,
  secondaryAddress = "",
  secondaryPort = "",
}) {
  const channelNumbers = Array.isArray(channels)
    ? channels
    : parseChannels(channels);
  if (!authoring)
    throw new Error(t("Flow authoring capabilities are unavailable."));

  const identifierMaximum = flowIdentifierMaximum(authoring, maximumFlows);
  if (
    !Number.isInteger(Number(flowId)) ||
    Number(flowId) < 1 ||
    Number(flowId) > identifierMaximum
  ) {
    throw new Error(
      t("Enter a flow identifier from 1 through {maximum}.", { maximum: identifierMaximum }),
    );
  }
  if (!authoring.media_modes.includes(mediaMode))
    throw new Error(t("This audio mode is not available for flow creation."));
  const socket = (address, port, message) => {
    if (!address && !port) return null;
    if (
      !address ||
      !Number.isInteger(Number(port)) ||
      Number(port) < 1 ||
      Number(port) > 65535
    )
      throw new Error(message);
    return { address, port: Number(port), interface: null };
  };
  const primaryDestination = socket(
    primaryAddress.trim(),
    primaryPort,
    t("Primary destination needs an IPv4 address and UDP port from 1 through 65535."),
  );
  const secondaryDestination = socket(
    secondaryAddress.trim(),
    secondaryPort,
    t("Secondary destination needs an IPv4 address and UDP port from 1 through 65535."),
  );
  const fpp = framesPerPacket === "" ? null : Number(framesPerPacket);
  if (fpp !== null && (!Number.isInteger(fpp) || fpp < 1 || fpp > 65535))
    throw new Error(t("Frames per packet must be from 1 through 65535."));
  return {
    schema_version: 1,
    media_mode: mediaMode,
    flow_type: "multicast",
    name: flowName.trim() || null,
    channel_slots: channelNumbers.map((transmitter_channel, index) => ({
      slot: index + 1,
      transmitter_channel,
    })),
    sample_rate_hz:
      Number.isInteger(Number(sampleRate)) && Number(sampleRate) > 0
        ? Number(sampleRate)
        : null,
    encoding_bits:
      Number.isInteger(Number(encoding)) && Number(encoding) > 0
        ? Number(encoding)
        : null,
    frames_per_packet: fpp,
    primary_destination: primaryDestination,
    secondary_destination: secondaryDestination,
    redundancy: "device_default",
    identity: {
      global_flow_id: null,
      media_type_code: null,
      media_local_flow_id: null,
      [authoring.identity_field]: Number(flowId),
    },
    protocol: {
      protocol_id: null,
      protocol_version: null,
      cohort: null,
      required_capabilities: [],
    },
    raw_fields: {},
  };
}

export function flowEvidenceRows(result) {
  const acknowledgement = result?.request_acknowledgement;
  let acknowledgementLabel = t("Not received");
  if (acknowledgement?.accepted === true) {
    acknowledgementLabel = t("Accepted");
  } else if (acknowledgement?.parseable === true) {
    acknowledgementLabel = t("Rejected");
  } else if (acknowledgement?.received === true) {
    acknowledgementLabel = t("Received but unparseable");
  }
  const confirmationLabel = (value, unavailable) =>
    value === true
      ? t("Confirmed")
      : value === false
        ? t("Contradicted")
        : unavailable;
  return [
    [t("Request acknowledgement"), acknowledgementLabel],
    [
      t("Device confirmation"),
      confirmationLabel(
        result?.device_confirmation,
        t("No separate signal from this ARC transport"),
      ),
    ],
    [
      t("Effective state"),
      confirmationLabel(result?.effective_state_confirmation, t("Unverified")),
    ],
    [
      t("Persistence"),
      confirmationLabel(result?.persistence_confirmation, t("Not verified")),
    ],
  ];
}

function socketLabel(socket) {
  if (!socket) return "";
  const endpoint = `${socket.address}:${socket.port}`;
  return socket.interface ? t("{endpoint} via {interface}", { endpoint, interface: socket.interface }) : endpoint;
}

function channelLabel(specification) {
  return (specification.channel_slots || [])
    .map((entry) => `${entry.slot}:${entry.transmitter_channel}`)
    .join(", ");
}

function capitalized(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

function receiverFlowEndpoints(flow) {
  const endpoints = Array.isArray(flow.interface_endpoints)
    ? flow.interface_endpoints
    : flow.destination_user_datagram_port != null
      ? [
          {
            ipv4_address:
              flow.destination_internet_protocol_version_four_address,
            udp_port: flow.destination_user_datagram_port,
          },
        ]
      : [];
  return endpoints
    .filter((endpoint) => endpoint.ipv4_address && endpoint.udp_port != null)
    .map((endpoint) => `${endpoint.ipv4_address}:${endpoint.udp_port}`)
    .join(", ");
}

function receiverFlowChannels(flow) {
  const slots = flow.receiver_channel_numbers_by_flow_channel;
  if (Array.isArray(slots)) {
    return slots
      .map((channels, index) => `${index + 1}:${channels.join(",") || t("none")}`)
      .join("; ");
  }
  return "";
}

function externalIdentityLabel(flow) {
  const identity = flow.external_identity;
  if (!identity) return "";
  return [identity.source_ipv4, identity.session_id].filter((value) => value != null).join("/");
}

export function ReceiverFlows({ device }) {
  const flows = Array.isArray(device.receiver_flows)
    ? device.receiver_flows
    : [];
  if (!flows.length) return null;
  const external = flows.some((flow) => flow.external_identity);
  const typed = flows.some((flow) => flow.flow_type);
  const mapped = flows.some((flow) => receiverFlowChannels(flow));
  const addressed = flows.some((flow) => receiverFlowEndpoints(flow));
  if (!typed && !mapped && !addressed && !external) return null;
  return html`<${Panel} title=${t("Receiver flows ({count})", { count: flows.length })}>
    <div class="table-wrapper">
      <table class="data">
        <thead>
          <tr>
            <th>${t("Flow")}</th>
            ${typed ? html`<th>${t("Type")}</th>` : null}
            ${mapped ? html`<th>${t("Slot:receiver channels")}</th>` : null}
            ${addressed ? html`<th>${t("Destination")}</th>` : null}
            ${external ? html`<th>${t("Source")}</th><th>SDP</th>` : null}
          </tr>
        </thead>
        <tbody>
          ${flows.map(
            (flow) =>
              html`<tr key=${flow.flow_number}>
                <td data-label=${t("Flow")}>${flow.flow_number ?? ""}</td>
                ${typed ? html`<td data-label=${t("Type")}>${t(capitalized(flow.flow_type))}</td>` : null}
                ${mapped ? html`<td data-label=${t("Slot:receiver channels")}>${receiverFlowChannels(flow)}</td>` : null}
                ${addressed ? html`<td data-label=${t("Destination")}>${receiverFlowEndpoints(flow)}</td>` : null}
                ${external
                  ? html`<td data-label=${t("Source")}>${externalIdentityLabel(flow)}</td>
                      <td data-label="SDP">
                        ${flow.sdp_correlation?.matched === true
                          ? t("Matched")
                          : flow.external_identity
                            ? t("Not matched")
                            : ""}
                      </td>`
                  : null}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  <//>`;
}

function flowTypeLabel(entry) {
  return [entry.media_mode === "rtp_aes67" ? "AES67" : null, t(capitalized(entry.flow_type))]
    .filter(Boolean)
    .join(" ");
}

function FlowRow({ entry, onDelete, requestName }) {
  const flowId = entry.identity?.global_flow_id;
  return html`<tr>
    <td data-label=${t("Flow")}>${flowId ?? ""}</td>
    <td data-label=${t("Type")}>${flowTypeLabel(entry)}</td>
    <td data-label=${t("Name")}>${entry.name || ""}</td>
    <td data-label=${t("Slot:channel")}>${channelLabel(entry)}</td>
    <td data-label=${t("Sample rate")}>${format.sampleRate(entry.sample_rate_hz)}</td>
    <td data-label=${t("Encoding")}>${entry.encoding_bits == null ? "" : `PCM ${entry.encoding_bits}`}</td>
    <td data-label=${t("Destination")}>${socketLabel(entry.primary_destination)}</td>
    <td data-label="">
      ${
        flowId == null
          ? null
          : html`<${AsyncButton}
              small
              variant="danger"
              description=${t("delete transmit flow {flow} on {device}", { flow: flowId, device: requestName })}
              onRun=${() => onDelete(flowId)}
              >${t("Delete")}<//
            >`
      }
    </td>
  </tr>`;
}

// Splits the channels into groups of perFlow, numbered downwards from flowId.
// Returns null when no split applies (no size given, or one flow suffices).
export function batchLayout(channels, perFlow, flowId) {
  if (String(perFlow).trim() === "") return null;
  const size = Number(perFlow);
  if (!Number.isInteger(size) || size < 1) throw new Error(t("Enter a whole number of channels per flow."));
  const numbers = parseChannels(channels);
  if (numbers.length <= size) return null;
  const groups = [];
  for (let index = 0; index < numbers.length; index += size) groups.push(numbers.slice(index, index + size));
  const first = Number(flowId);
  if (!Number.isInteger(first) || first - (groups.length - 1) < 1) {
    throw new Error(t("Not enough flow identifiers below {first} for {count} flows.", { first: flowId, count: groups.length }));
  }
  return { groups, identifiers: groups.map((_, index) => first - index) };
}

function batchSummary(channels, perFlow, flowId) {
  try {
    const layout = batchLayout(channels, perFlow, flowId);
    if (!layout) return null;
    return html`<small>${t("Creates {count} flows, numbered {first} down to {last}.", {
      count: layout.groups.length,
      first: layout.identifiers[0],
      last: layout.identifiers[layout.identifiers.length - 1],
    })}</small>`;
  } catch {
    return null;
  }
}

function FlowField({ children, label }) {
  return html`<label class="flow-field"><span>${label}</span>${children}</label>`;
}

export function TransmitFlows({ device }) {
  const requestName = deviceRequestName(device);
  const [inventory, setInventory] = useState(null);
  const [error, setError] = useState("");
  const [channels, setChannels] = useState("");
  const [perFlow, setPerFlow] = useState("");
  const [flowId, setFlowId] = useState("1");
  const [flowName, setFlowName] = useState("");
  const [framesPerPacket, setFramesPerPacket] = useState("");
  const [mediaMode, setMediaMode] = useState("native_dante");
  const [primaryAddress, setPrimaryAddress] = useState("");
  const [primaryPort, setPrimaryPort] = useState("");
  const [secondaryAddress, setSecondaryAddress] = useState("");
  const [secondaryPort, setSecondaryPort] = useState("");
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const authoring = device.transmit_flow_authoring;
  const maximumFlows = device.maximum_transmit_flows;
  const authoringFacts = JSON.stringify([requestName, authoring, device.aes67_current,
    device.aes67_configuration_supported, device.is_locked, device.sample_rate_hz, device.encoding, maximumFlows]);
  useEffect(() => {
    setPlan(null);
    setResult(null);
    setFlowId("");
    setMediaMode("native_dante");
  }, [authoringFacts]);
  const refresh = async () => {
    try {
      setInventory(await api.getTransmitFlows(requestName));
    } catch (failure) {
      console.error(failure);
    }
  };
  useEffect(() => {
    setInventory(null);
    setPlan(null);
    setResult(null);
    setError("");
    void refresh();
  }, [requestName]);
  const specification = (overrides = {}) =>
    canonicalFlowRequest({
      channels,
      encoding: device.encoding,
      flowId,
      flowName,
      framesPerPacket,
      maximumFlows,
      mediaMode,
      primaryAddress,
      primaryPort,
      authoring,
      sampleRate: device.sample_rate_hz,
      secondaryAddress,
      secondaryPort,
      ...overrides,
    });
  // With a channels-per-flow size, the channels are split into several flows,
  // numbered downwards from the identifier as Dante Controller does.
  const specifications = () => {
    const layout = batchLayout(channels, perFlow, flowId);
    if (!layout) return [specification()];
    return layout.groups.map((group, index) =>
      specification({ channels: group, flowId: String(layout.identifiers[index]) }),
    );
  };
  const preview = async () => {
    setResult(null);
    try {
      const plans = [];
      for (const request of specifications()) {
        plans.push((await api.planTransmitFlow(requestName, request)).plan);
      }
      setPlan({
        supported: plans.every((entry) => entry.supported),
        reasons: plans.flatMap((entry) => (entry.supported ? [] : entry.reasons)),
        count: plans.length,
      });
      setError("");
    } catch (failure) {
      setPlan(null);
      setError(failure.message);
    }
  };
  const create = async () => {
    try {
      const requests = specifications();
      let created = 0;
      let last = null;
      for (const request of requests) {
        last = await api.createTransmitFlow(requestName, request);
        // Stop at the first flow that isn't confirmed; earlier ones stay created.
        if (last?.state !== "confirmed") break;
        created += 1;
      }
      setResult(
        requests.length > 1
          ? { ...last, message: t("Created {created} of {count} flows.", { created, count: requests.length }) }
          : last,
      );
      setError(requests.length > 1 && created < requests.length && last?.message ? t(last.message) : "");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPlan(null);
    }
    await refresh();
  };
  const remove = async (identifier) => {
    const response = await api.deleteTransmitFlow(requestName, identifier);
    setResult(response);
    await refresh();
  };
  const flowEntries = inventory?.flows || [];
  if (!authoring && !flowEntries.length) return null;
  const supportsFlowOptions = authoring?.supports_flow_options === true;
  const edit = (setter) => (event) => {
    setter(event.target.value);
    setPlan(null);
  };
  return html`<${Panel} title=${t("Transmit flows ({count})", { count: flowEntries.length })}>
    ${
      flowEntries.length
        ? html`<div class="table-wrapper">
            <table class="data">
              <thead>
                <tr>
                  <th>${t("Flow")}</th>
                  <th>${t("Type")}</th>
                  <th>${t("Name")}</th>
                  <th>${t("Slot:channel")}</th>
                  <th>${t("Sample rate")}</th>
                  <th>${t("Encoding")}</th>
                  <th>${t("Destination")}</th>
                  <th><span class="sr-only">${t("Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                ${flowEntries.map((entry) => html`<${FlowRow} key=${entry.identity?.global_flow_id} entry=${entry} onDelete=${remove} requestName=${requestName} />`)}
              </tbody>
            </table>
          </div>`
        : null
    }
    ${
      authoring
        ? html`<form
            class="flow-form"
            onSubmit=${(event) => {
              event.preventDefault();
              void preview();
            }}
          >
            <h3 class="flow-form-title">${t("New multicast flow")}</h3>
            <div class="flow-form-fields">
              <${FlowField} label=${t("Transmit channels")}>
                <input aria-label=${t("Transmit flow channels")} placeholder="1-64" value=${channels} onInput=${edit(setChannels)} />
                ${channelCount(channels) ? html`<small>${t("Channels: {count}", { count: channelCount(channels) })}</small>` : null}
              <//>
              <${FlowField} label=${t("Channels per flow")}>
                <input
                  type="number"
                  min="1"
                  max="64"
                  placeholder=${t("All")}
                  aria-label=${t("Transmit flow channels per flow")}
                  value=${perFlow}
                  onInput=${edit(setPerFlow)}
                />
                ${batchSummary(channels, perFlow, flowId)}
              <//>
              <${FlowField} label=${{ media_local_flow_id: t("Media-local flow identifier"), global_flow_id: t("Global flow identifier") }[authoring.identity_field] || t("Flow identifier")}>
                <input
                  type="number"
                  min="1"
                  max=${flowIdentifierMaximum(authoring, maximumFlows)}
                  aria-label=${t("Transmit flow identifier")}
                  value=${flowId}
                  onInput=${edit(setFlowId)}
                />
              <//>
              ${
                authoring.media_modes.length > 1
                  ? html`<${FlowField} label=${t("Mode")}>
                      <select aria-label=${t("Transmit flow media mode")} value=${mediaMode} onChange=${edit(setMediaMode)}>
                        ${authoring.media_modes.map((mode) => html`<option value=${mode}
                          disabled=${mode === "rtp_aes67" && (device.aes67_configuration_supported !== true || device.aes67_current !== true)}
                          >${mode === "native_dante" ? t("Native Dante") : "RTP/AES67"}</option>`)}
                      </select>
                    <//>`
                  : null
              }
              ${
                supportsFlowOptions
                  ? html`<${FlowField} label=${t("Flow name")}>
                        <input aria-label=${t("Transmit flow name")} value=${flowName} onInput=${edit(setFlowName)} />
                      <//>
                      <${FlowField} label=${t("Frames per packet")}>
                        <input
                          type="number"
                          min="1"
                          max="65535"
                          aria-label=${t("Transmit flow frames per packet")}
                          value=${framesPerPacket}
                          onInput=${edit(setFramesPerPacket)}
                        />
                      <//>`
                  : null
              }
              ${
                supportsFlowOptions && mediaMode === "rtp_aes67"
                  ? html`<${FlowField} label=${t("Primary IPv4")}>
                        <input aria-label=${t("Primary RTP destination address")} value=${primaryAddress} onInput=${edit(setPrimaryAddress)} />
                      <//>
                      <${FlowField} label=${t("Primary UDP port")}>
                        <input type="number" min="1" max="65535" aria-label=${t("Primary RTP destination port")} value=${primaryPort} onInput=${edit(setPrimaryPort)} />
                      <//>
                      <${FlowField} label=${t("Secondary IPv4")}>
                        <input aria-label=${t("Secondary RTP destination address")} value=${secondaryAddress} onInput=${edit(setSecondaryAddress)} />
                      <//>
                      <${FlowField} label=${t("Secondary UDP port")}>
                        <input type="number" min="1" max="65535" aria-label=${t("Secondary RTP destination port")} value=${secondaryPort} onInput=${edit(setSecondaryPort)} />
                      <//>`
                  : null
              }
            </div>
            <div class="flow-form-actions">
              <button class="btn btn-sm" type="submit">${t("Plan")}</button>
              ${
                plan?.supported
                  ? html`<${AsyncButton}
                      variant="primary"
                      description=${(plan.count || 1) > 1
                        ? t("create the planned transmit flows on {device}", { device: requestName })
                        : t("create the planned transmit flow on {device}", { device: requestName })}
                      onRun=${create}
                      >${t("Create")}<//
                    >`
                  : null
              }
            </div>
            ${error ? html`<p role="alert" class="text-error">${t(error)}</p>` : null}
            ${plan && !plan.supported ? html`<p role="alert" class="text-error">${plan.reasons.map((reason) => t(reason)).join("; ")}</p>` : null}
            ${plan?.supported
              ? html`<p role="status">${(plan.count || 1) > 1 ? t("Ready to create {count} flows.", { count: plan.count }) : t("Ready to create.")}</p>`
              : null}
            ${result ? html`<p role="status">${t(result.message || capitalized(result.state))}</p>` : null}
          </form>`
        : html`${result ? html`<p role="status">${t(result.message || capitalized(result.state))}</p>` : null}`
    }
  <//>`;
}
