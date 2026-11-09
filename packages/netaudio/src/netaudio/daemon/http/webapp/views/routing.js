import { api } from "../api.js";
import { AsyncButton, Button, Notice } from "../components.js";
import * as format from "../format.js";
import { t } from "../i18n.js";
import { html, useEffect, useLayoutEffect, useState } from "../lib/preact.js";
import { RoutingControls } from "../routing-controls.js";
import { Icon } from "../icons.js";
import { buildMatrixModel, expanded, initializeExpansion, RoutingMatrix, setAllExpanded } from "../matrix.js";
import { channelGroups, enableChannelGroups, groupChannels, setGroupsExpanded } from "../channel-groups.js";
import { devicePath, navigate } from "../router.js";
import { contextDevices, contextExternalFlows, deviceRequestName, pendingSubscriptions, scopedDevices as devices } from "../store.js";
import { inventoryFilters, saveRoutingFilters } from "../device-filters.js";

export const routingLayout = { compactQuery: "(max-width: 900px)" };

// Transmitter channel n goes to receiver channel n, for every number both have.
export function patchPairs(transmitter, receiver) {
  const sending = transmitter?.channels?.transmitters || {};
  const receiving = receiver?.channels?.receivers || {};
  return Object.keys(sending)
    .map(Number)
    .filter((number) => Number.isInteger(number) && receiving[number] !== undefined && sending[number]?.name)
    .sort((first, second) => first - second)
    .map((number) => ({ rx_channel: number, tx_channel: sending[number].name, tx_device: transmitter.name }));
}

function BulkPatch({ devices: available }) {
  const online = available.filter((device) => device.online !== false && device.channels);
  const transmitters = online.filter((device) => Object.keys(device.channels.transmitters || {}).length);
  const receivers = online.filter((device) => Object.keys(device.channels.receivers || {}).length);
  const [from, setFrom] = useState(transmitters[0]?.name || "");
  const [to, setTo] = useState(receivers.find((device) => device.name !== from)?.name || "");
  const transmitter = transmitters.find((device) => device.name === from);
  const receiver = receivers.find((device) => device.name === to);
  const pairs = transmitter && receiver && from !== to ? patchPairs(transmitter, receiver) : [];
  return html`
    <div class="toolbar">
      <label>${t("From")}
        <select value=${from} onChange=${(event) => setFrom(event.currentTarget.value)}>
          ${transmitters.map((device) => html`<option key=${device.name} value=${device.name}>${device.name}</option>`)}
        </select>
      </label>
      <label>${t("To")}
        <select value=${to} onChange=${(event) => setTo(event.currentTarget.value)}>
          <option value="">${t("Choose a receiver")}</option>
          ${receivers.map((device) => html`<option key=${device.name} value=${device.name}>${device.name}</option>`)}
        </select>
      </label>
      <${AsyncButton}
        variant="primary"
        small
        disabled=${!pairs.length}
        description=${t("patch {transmitter} to {receiver} one to one", { transmitter: from, receiver: to })}
        onRun=${() => api.subscribe({ rx_device: deviceRequestName(receiver), subscriptions: pairs })}
        >${t("Patch {count} channels", { count: pairs.length })}<//>
      <small>${t("Each transmit channel goes to the receive channel with the same number.")}</small>
    </div>
  `;
}

function RoutingView() {
  const all = format.sortedDevices(contextDevices.value);
  useLayoutEffect(() => initializeExpansion(all), [devices.value]);
  const [compact, setCompact] = useState(() => window.matchMedia(routingLayout.compactQuery).matches);
  const filters = inventoryFilters.value;
  const listMode = filters.listMode === true;
  const receiverFilter = filters.receiverSearch || "";
  const transmitterFilter = filters.transmitterSearch || "";
  const updateFilters = saveRoutingFilters;
  const [gridLocked, setGridLocked] = useState(() => {
    try { return window.localStorage.getItem("netaudio.matrix.locked") === "true"; }
    catch { return false; }
  });
  const [flipped, setFlipped] = useState(() => {
    try { return window.localStorage.getItem("netaudio.matrix.flipped") !== "false"; }
    catch { return true; }
  });
  useEffect(() => {
    const media = window.matchMedia(routingLayout.compactQuery);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [bulkPatch, setBulkPatch] = useState(false);
  const state = expanded.value;
  const groups = channelGroups.value;
  const pending = pendingSubscriptions.value;

  if (!all.length) {
    return html`<${Notice}>${t("No Dante devices have been discovered yet.")}<//>`;
  }

  const visible = format.sortedDevices(devices.value);
  const filteredDevices = devices.value;
  const showList = compact || listMode;
  const model = buildMatrixModel({
    devices: filteredDevices,
    externalFlows: contextExternalFlows.value,
    expandedReceivers: state.receivers,
    expandedTransmitters: state.transmitters,
    receiverFilter,
    transmitterFilter,
    groups,
    pending,
  });
  const receiverLabels = model.rows.filter((row) => row.kind === "device").map((row) => row.label);
  const transmitterLabels = model.columns.filter((column) => column.kind === "device").map((column) => column.label);
  const expandGroups = (side, value) => {
    const axis = side === "receivers" ? model.rows : model.columns;
    const keys = axis.filter((entry) => entry.kind === "device" && entry.sourceKind !== "external").flatMap((entry) =>
      groupChannels(deviceRequestName(entry.device), entry.channels).map((group) => group.key));
    setGroupsExpanded(side, keys, value);
  };
  const expandDevices = (side, value) => {
    setAllExpanded(side, side === "receivers" ? receiverLabels : transmitterLabels, value);
    expandGroups(side, value);
  };

  return html`
    <div class=${showList ? "routing-list flex flex-col gap-4" : "routing-grid flex flex-col"}>
      <div class="content-header">
        <div class="toolbar">
          ${!compact ? html`<${Button} onClick=${() => updateFilters({ ...filters, listMode: !listMode })}>${listMode ? t("Show grid") : t("Channel list")}<//>` : null}
          <button class="btn btn-sm" type="button" aria-pressed=${bulkPatch} onClick=${() => setBulkPatch(!bulkPatch)}>${t("Patch 1:1")}</button>
          ${!showList ? html`
          <button class="btn btn-sm" type="button" aria-pressed=${gridLocked}
            onClick=${() => {
              setGridLocked(!gridLocked);
              try { window.localStorage.setItem("netaudio.matrix.locked", String(!gridLocked)); } catch {}
            }}><${Icon} name=${gridLocked ? "lock" : "unlock"} /><span class="steady-label">
              <span aria-hidden=${gridLocked ? null : "true"}>${t("Locked")}</span>
              <span aria-hidden=${gridLocked ? "true" : null}>${t("Unlocked")}</span>
            </span></button>
          <button class="btn btn-sm" type="button" aria-pressed=${!flipped} onClick=${() => {
            setFlipped(!flipped);
            try { window.localStorage.setItem("netaudio.matrix.flipped", String(!flipped)); } catch {}
          }}><${Icon} name="flip" /> ${t("Flip axes")}</button>
          <button class="btn btn-sm" type="button" aria-pressed=${groups.enabled} onClick=${() => enableChannelGroups(!groups.enabled)}><${Icon} name="groups" /> ${t("Channel groups")}</button>
          ` : null}
        </div>
        ${bulkPatch ? html`<${BulkPatch} devices=${all} />` : null}
      </div>
      <div class="routing-workspace">
        <div class="routing-results">
      ${showList ? html`<${RoutingControls} all=${visible.filter((device) => device.online)} />`
        : model.rows.length === 0 || model.columns.length === 0
        ? html`<${Notice}>${t("No devices match the current filters.")}<//>`
        : html`<${RoutingMatrix}
            locked=${gridLocked}
            pending=${pending}
            key=${flipped ? "transposed" : "normal"}
            flipped=${flipped}
            receiverFilter=${receiverFilter}
            transmitterFilter=${transmitterFilter}
            onReceiverFilter=${(value) => updateFilters({ ...filters, receiverSearch: value })}
            onTransmitterFilter=${(value) => updateFilters({ ...filters, transmitterSearch: value })}
            onExpandDevices=${expandDevices}
            rows=${model.rows}
            columns=${model.columns}
            subscriptionIndex=${model.subscriptionIndex}
            onOpenDevice=${(label, tab) => navigate(devicePath("devices", label, tab))}
          />`}
        </div>
      </div>
    </div>
  `;
}

export const routingView = {
  component: RoutingView,
  id: "routing",
  label: t("Routing"),
};
