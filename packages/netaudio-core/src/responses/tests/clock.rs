use super::*;
use crate::commands::{build_clock_control, build_refresh_clock_status, ClockControl};

// Synthetic vectors constructed from the supplied clock specification, not device observations.
fn word(r: &mut [u8], at: usize, value: u16) {
    r[at..at + 2].copy_from_slice(&value.to_be_bytes());
}
fn packet(rev: u16, extension: usize) -> Vec<u8> {
    let mut data = vec![0; 24 + extension + 156];
    stamp_conmon_response(&mut data, 0x0020);
    let r = &mut data[24..];
    word(r, 0, rev);
    word(r, 8, 3);
    word(r, 10, 3);
    r[14] = 1;
    r[15] = 7;
    r[20..26].copy_from_slice(&[1, 2, 3, 4, 5, 6]);
    r[28..34].copy_from_slice(&[7, 8, 9, 10, 11, 12]);
    r[36..42].copy_from_slice(&[13, 14, 15, 16, 17, 18]);
    word(r, 44, 1);
    word(r, 46, extension as u16);
    word(r, 48, 9);
    word(r, extension, 0x0284);
    word(r, extension + 10, 0x1800);
    r[extension + 9] = 23;
    r[extension + 12..extension + 16].copy_from_slice(b"lab\0");
    word(r, extension + 28, 0x0013);
    word(r, extension + 30, 3);
    let v = extension + 48;
    let records = extension + 64;
    let v3 = extension + 128;
    word(r, extension + 32, v as u16);
    word(r, extension + 34, 1);
    word(r, extension + 40, v3 as u16);
    word(r, extension + 42, 1);
    word(r, v, 4);
    word(r, v + 2, 0x1234);
    word(r, v + 4, records as u16);
    word(r, v + 6, 16);
    word(r, v3, 4);
    word(r, v3 + 4, (v3 + 8) as u16);
    word(r, v3 + 6, 4);
    for i in 0..4 {
        let p = records + i * 16;
        word(r, p, 4);
        word(r, p + 2, (i + 1) as u16);
        r[p + 4] = 1;
        r[p + 6] = 1;
        r[p + 8..p + 12].copy_from_slice(&0xdeadbeefu32.to_be_bytes());
        word(r, p + 12, if i == 0 { 6 } else { 9 });
        word(r, p + 14, 7);
        word(r, v3 + 8 + i * 4, if i == 3 { 0 } else { 1 });
        word(r, v3 + 10 + i * 4, [0, 1, 77, 88][i]);
    }
    data
}

#[test]
fn mute_state_preserves_unknown_reasons_without_guessing_their_meaning() {
    for (flags, state, reasons) in [
        (0, "unmuted", vec![]),
        (1, "muted", vec!["synchronization loss"]),
        (0x8000, "muted", vec!["unknown reason"]),
        (
            0x8001,
            "muted",
            vec!["synchronization loss", "unknown reason"],
        ),
    ] {
        let mut bytes = packet(0x073a, 64);
        word(&mut bytes[24..], 64 + 28, flags);
        let status = parse_ptp_clock_status(&bytes).unwrap();
        assert_eq!(status.mute_state, Some(state));
        assert_eq!(status.mute_reasons, reasons);
    }
}

#[test]
fn dynamic_pointer_distinct_uuids_and_interface_geometry() {
    for e in [64, 112, 216] {
        let bytes = packet(0x073a, e);
        let s = parse_ptp_clock_status(&bytes).unwrap();
        assert_ne!(s.ptpv1_master_uuid, s.ptpv1_grandmaster_uuid);
        assert_eq!(s.ptpv1_device_uuid, Some([1, 2, 3, 4, 5, 6]));
        assert_eq!(s.raw_record, bytes[24..]);
        assert_eq!(s.synchronization, "synchronized");
        assert_eq!(s.ptpv2_domain, Some(23));
        assert_eq!(s.mute_flags, Some(19));
        assert_eq!(s.mute_reasons.len(), 3);
        assert_eq!(s.preferred_leader_locked, Some(true));
        let ports = s.clock_port_records.unwrap();
        assert_eq!(
            ports
                .iter()
                .map(|p| p.network_interface_index)
                .collect::<Vec<_>>(),
            vec![None, None, None, None]
        );
        assert!(ports.iter().all(|p| p.unknown_word == 0xdeadbeef));
        assert_eq!(ports[0].role.as_deref(), Some("Leader"));
        assert_eq!(ports[1].role.as_deref(), Some("Follower"));
    }
}

#[test]
fn flag_validity_and_revision_gates() {
    for rev in [0x071c, 0x071e, 0x071f, 0x0724, 0x073a, 0x0800] {
        let mut bytes = packet(rev, 64);
        word(&mut bytes[24..], 128 + 14, 0);
        let s = parse_ptp_clock_status(&bytes).unwrap();
        let p = &s.clock_port_records.unwrap()[0];
        assert_eq!(p.link_down, if rev < 0x071f { Some(false) } else { None });
        assert_eq!(
            p.user_disabled,
            if rev < 0x071f { Some(false) } else { None }
        );
        assert_eq!(p.unicast_delay_requests, None);
        assert_eq!(p.network_interface_index, None);
        assert_eq!(s.ptpv2_domain, if rev < 0x0728 { None } else { Some(23) });
    }
}

#[test]
fn legacy_unknown_and_missing_extensions() {
    let mut bytes = packet(0x0100, 64);
    let r = &mut bytes[24..];
    word(r, 20, 3);
    word(r, 24, 6);
    word(r, 28, 9);
    word(r, 32, 0xeeee);
    let s = parse_ptp_clock_status(&bytes).unwrap();
    assert_eq!(s.base_ports.len(), 3);
    assert_eq!(s.base_ports[2].state, None);
    assert_eq!(s.ptpv1_device_uuid, None);
    {
        let mut bytes = packet(0x073a, 64);
        word(&mut bytes[24..], 46, 0);
        assert_eq!(
            parse_ptp_clock_status(&bytes).unwrap().clock_capabilities,
            None
        );
    }
    word(&mut bytes[24..], 0, 0x0101);
    let s = parse_ptp_clock_status(&bytes).unwrap();
    assert!(!s.status_supported);
    assert_eq!(s.synchronization, "unknown");
}

#[test]
fn malformed_regions_and_lengths_fail_closed() {
    let bytes = packet(0x073a, 64);
    for length in 0..bytes.len() {
        assert!(parse_ptp_clock_status(&bytes[..length]).is_none());
    }
    for (at, value) in [
        (44, 0xffff),
        (46, 48),
        (112, 0xffff),
        (116, 0xffff),
        (118, 15),
        (46, 0xffff),
    ] {
        let mut bad = bytes.clone();
        word(&mut bad[24..], at, value);
        assert!(parse_ptp_clock_status(&bad).is_none(), "offset {at}");
    }
    let mut bad = bytes.clone();
    bad[24 + 64 + 12..24 + 64 + 28].fill(b'x');
    assert!(parse_ptp_clock_status(&bad).is_none());
}

#[test]
fn synchronization_is_servo_and_loss_predicate_only() {
    for (clock, servo, stratum, port, expected) in [
        (0, 3, 255, 4, "synchronized"),
        (3, 2, 1, 9, "lost"),
        (2, 2, 1, 6, "synchronizing"),
        (2, 6, 255, 4, "lost"),
        (2, 6, 1, 6, "unknown"),
    ] {
        let mut bytes = packet(0x073a, 64);
        let r = &mut bytes[24..];
        word(r, 8, clock);
        word(r, 10, servo);
        r[15] = stratum;
        word(r, 48, port);
        assert_eq!(
            parse_ptp_clock_status(&bytes).unwrap().synchronization,
            expected
        );
    }
}

#[test]
fn control_masks_query_padding_and_gates() {
    let mac = [1, 2, 3, 4, 5, 6];
    let query = build_refresh_clock_status(0x073a, mac, 9).unwrap();
    assert_eq!(query.len(), 92);
    assert_eq!(&query[24..26], &[7, 0x3a]);
    assert!(query[32..].iter().all(|v| *v == 0));
    assert_eq!(
        build_refresh_clock_status(0x0734, mac, 9).unwrap().len(),
        64
    );
    assert!(build_refresh_clock_status(0, mac, 9).is_err());
    let base = ClockControl {
        status_revision: Some(0x073a),
        clock_capabilities: Some(0x0204),
        extension_flags: Some(0),
        ..Default::default()
    };
    for (field, mask) in [(0, 1u16), (1, 2), (2, 8)] {
        let mut c = base.clone();
        match field {
            0 => c.clock_source = Some(0),
            1 => c.preferred_leader = Some(true),
            _ => c.subdomain = Some(b"lab".to_vec()),
        };
        let data = build_clock_control(&c, mac, 9).unwrap();
        assert_eq!(&data[32..34], &mask.to_be_bytes());
    }
    let mut c = base.clone();
    c.clock_source = Some(0);
    c.preferred_leader = Some(true);
    c.subdomain = Some(b"lab".to_vec());
    c.aggregate_ptpv1_unicast_delay_requests = Some(true);
    let data = build_clock_control(&c, mac, 9).unwrap();
    assert_eq!(&data[32..34], &11u16.to_be_bytes());
    assert_eq!(&data[56..60], &[2, 0, 2, 0]);
    assert_eq!(&data[37..40], &[0, 0, 0]);
    for cap in [0x20, 0x100] {
        let mut bad = c.clone();
        bad.clock_capabilities = Some(cap);
        assert!(build_clock_control(&bad, mac, 9).is_err());
    }
    c.extension_flags = Some(0x1000);
    assert!(build_clock_control(&c, mac, 9).is_err());
    let mut c = base.clone();
    c.clock_source = Some(1);
    assert!(build_clock_control(&c, mac, 9).is_err());
    c.supported_clock_sources = vec![1, 2];
    assert!(build_clock_control(&c, mac, 9).is_ok());
    c.clock_source = Some(2);
    assert!(build_clock_control(&c, mac, 9).is_ok());
    let mut c = base.clone();
    c.clock_capabilities = Some(8);
    c.status_revision = Some(0x071e);
    c.global_unicast_delay_requests = Some(true);
    let data = build_clock_control(&c, mac, 9).unwrap();
    assert_eq!(&data[56..60], &[0, 1, 0, 1]);
    c.clock_capabilities = Some(0x208);
    assert!(build_clock_control(&c, mac, 9).is_err());
}

#[test]
fn diagnostic_records_preserve_raw_data_and_enforce_their_own_bounds() {
    let mut master = vec![0; 24 + 32];
    stamp_conmon_response(&mut master, 0x0022);
    word(&mut master[24..], 8, 2);
    word(&mut master[24..], 10, 12);
    word(&mut master[24..], 12, 3);
    word(&mut master[24..], 14, 9);
    master[40..44].copy_from_slice(&[1, 2, 3, 4]);
    let parsed = parse_clock_master_status(&master).unwrap();
    assert_eq!(parsed.status_codes, vec![3, 9]);
    assert_eq!(parsed.block_padding, vec![1, 2, 3, 4]);
    assert_eq!(parsed.raw_record, master[24..]);
    word(&mut master[24..], 8, u16::MAX);
    assert!(parse_clock_master_status(&master).is_none());
    word(&mut master[24..], 8, 2);
    word(&mut master[24..], 10, u16::MAX);
    assert!(parse_clock_master_status(&master).is_none());

    let mut unicast = vec![0; 48];
    stamp_conmon_response(&mut unicast, 0x0024);
    unicast[32..48].fill(0xff);
    let parsed = parse_clock_unicast_status(&unicast).unwrap();
    assert_eq!(parsed.raw_words, [u32::MAX; 4]);
    assert_eq!(parsed.raw_record, unicast[24..]);
    unicast.pop();
    word(&mut unicast, 2, 47);
    assert!(parse_clock_unicast_status(&unicast).is_none());

    let mut named = vec![0; 76];
    stamp_conmon_response(&mut named, 0x0026);
    let r = &mut named[24..];
    for (at, value) in [
        (8, 52),
        (10, 1),
        (12, 16),
        (14, 3),
        (16, 26),
        (20, 38),
        (24, 46),
    ] {
        word(r, at, value);
    }
    r[26..30].copy_from_slice(b"abc\0");
    r[38..44].copy_from_slice(&[1, 2, 3, 4, 5, 6]);
    r[46..52].copy_from_slice(&[7, 8, 9, 10, 11, 12]);
    let parsed = parse_clock_identifier_status(&named).unwrap();
    assert_ne!(parsed.first_identifier, parsed.second_identifier);
    assert_eq!(parsed.name_bytes, b"abc");
    for (at, value) in [(8, 51), (14, 16), (16, 25), (20, 46), (24, u16::MAX)] {
        let mut bad = named.clone();
        word(&mut bad[24..], at, value);
        assert!(parse_clock_identifier_status(&bad).is_none());
    }
    named[24 + 29] = b'x';
    assert!(parse_clock_identifier_status(&named).is_none());
}

#[test]
fn selected_false_values_and_invalid_control_fields() {
    let mac = [1, 2, 3, 4, 5, 6];
    for (capability, global, aggregate, expected) in [
        (8, Some(false), None, 1u16),
        (0x200, None, Some(false), 0x200),
    ] {
        let control = ClockControl {
            status_revision: Some(if global.is_some() { 0x071e } else { 0x0738 }),
            clock_capabilities: Some(capability),
            global_unicast_delay_requests: global,
            aggregate_ptpv1_unicast_delay_requests: aggregate,
            ..Default::default()
        };
        let packet = build_clock_control(&control, mac, 1).unwrap();
        assert_eq!(&packet[56..58], &expected.to_be_bytes());
        assert_eq!(&packet[58..60], &[0, 0]);
    }
    let mut control = ClockControl {
        status_revision: Some(0x0738),
        clock_capabilities: Some(4),
        subdomain: Some(vec![b'x'; 16]),
        ..Default::default()
    };
    assert!(build_clock_control(&control, mac, 1).is_err());
    control.subdomain = None;
    control.clock_source = Some(3);
    assert!(build_clock_control(&control, mac, 1).is_err());
}

// Clock status from a Behringer WING Compact (Dante 4.2.9.4, record revision
// 0x0738) with AES67 enabled, so its multicast PTPv2 port is running. Clock
// identities are replaced with placeholders.
const WING_CLOCK_STATUS: [u8; 216] = [
    7, 56, 0, 32, 0, 0, 0, 0, 0, 3, 0, 3, 0, 0, 0, 123, 0, 0, 24, 84, 0, 1, 2, 3, 4, 5, 0, 0, 2, 0,
    0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 52, 0, 6, 0, 0, 2, 180, 0, 0, 0, 3, 13, 64,
    0, 0, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 96, 12, 0, 0, 0, 0,
    12, 0, 168, 0, 32, 0, 4, 0, 0, 0, 104, 16, 0, 0, 0, 0, 1, 1, 2, 1, 0, 0, 0, 0, 2, 0, 6, 0, 7,
    0, 0, 0, 2, 2, 2, 1, 0, 0, 0, 0, 2, 0, 9, 0, 7, 0, 1, 0, 3, 1, 2, 2, 0, 0, 0, 0, 2, 0, 3, 0, 3,
    0, 1, 0, 4, 2, 2, 2, 0, 0, 0, 0, 2, 0, 3, 0, 3, 0, 4, 0, 7, 0, 200, 0, 4, 0, 1, 2, 255, 254, 3,
    4, 5, 2, 0, 0, 255, 254, 0, 0, 1, 2, 0, 0, 255, 254, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 1, 0, 0,
];

fn wing_clock_status(ptpv2_disabled: bool) -> Vec<u8> {
    let mut data = vec![0; 24];
    data.extend_from_slice(&WING_CLOCK_STATUS);
    stamp_conmon_response(&mut data, 0x0020);
    let records = &mut data[24..];
    let ptpv2_multicast = records
        .windows(4)
        .position(|w| w == [0, 2, 2, 2])
        .expect("PTPv2 multicast port record")
        - 2;
    records[ptpv2_multicast + 1] = u8::from(ptpv2_disabled);
    data
}

#[test]
fn wing_ptpv2_multicast_port_state_is_reported() {
    let enabled = parse_ptp_clock_status(&wing_clock_status(false)).unwrap();
    let ports = enabled.clock_port_records.as_ref().unwrap();
    assert_eq!(ports.len(), 4);
    assert_eq!(
        (ports[1].ptp_version, ports[1].transport_path.as_deref()),
        (2, Some("multicast"))
    );
    assert_eq!(enabled.ptpv2_enabled, Some(true));

    let disabled = parse_ptp_clock_status(&wing_clock_status(true)).unwrap();
    assert_eq!(
        disabled.clock_port_records.unwrap()[1].user_disabled,
        Some(true)
    );
    assert_eq!(disabled.ptpv2_enabled, Some(false));
}

#[test]
fn wing_ptpv2_enable_plans_the_observed_control_record() {
    let status = |disabled| {
        serde_json::to_value(parse_ptp_clock_status(&wing_clock_status(disabled)).unwrap())
            .unwrap()
            .as_object()
            .unwrap()
            .clone()
    };
    let availability = crate::clock_configuration::control_availability(&status(true).into());
    assert!(availability.ptpv2_enabled);

    let plan = crate::clock_configuration::plan_configuration(
        serde_json::from_value(serde_json::json!({
            "status": status(true),
            "changes": {"ptpv2_enabled": true},
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        plan.changes.get("ptpv2_enabled"),
        Some(&serde_json::json!(true))
    );

    // The record that switched the WING's PTPv2 multicast port on.
    let sent = build_clock_control(
        &serde_json::from_value(serde_json::Value::Object(plan.control)).unwrap(),
        [0x02, 0x00, 0x5e, 0x00, 0x00, 0x01],
        0x1234,
    )
    .unwrap();
    let mut record = [0u8; 68];
    record[0..8].copy_from_slice(&[0x07, 0x3a, 0x00, 0x21, 0x00, 0x00, 0x00, 0x64]);
    record[32..36].copy_from_slice(&[0x00, 0x10, 0x00, 0x10]);
    assert_eq!(sent[24..], record[..]);

    assert!(crate::clock_configuration::configuration_matches(
        &serde_json::from_value(serde_json::json!({
            "status": status(false),
            "requested": {"ptpv2_enabled": true},
        }))
        .unwrap()
    )
    .unwrap());
}

#[test]
fn wing_ptpv2_unicast_delay_requests_plan_the_extended_bit() {
    let parsed = parse_ptp_clock_status(&wing_clock_status(false)).unwrap();
    assert_eq!(parsed.aggregate_ptpv1_unicast_delay_requests, Some(false));
    assert_eq!(parsed.aggregate_ptpv2_unicast_delay_requests, Some(false));
    let status = serde_json::to_value(parsed)
        .unwrap()
        .as_object()
        .unwrap()
        .clone();
    let availability = crate::clock_configuration::control_availability(&status.clone().into());
    assert!(availability.aggregate_ptpv2_unicast_delay_requests);

    let plan = crate::clock_configuration::plan_configuration(
        serde_json::from_value(serde_json::json!({
            "status": status,
            "changes": {"aggregate_ptpv2_unicast_delay_requests": true},
        }))
        .unwrap(),
    )
    .unwrap();
    let sent = build_clock_control(
        &serde_json::from_value(serde_json::Value::Object(plan.control)).unwrap(),
        [0x02, 0x00, 0x5e, 0x00, 0x00, 0x01],
        0x1234,
    )
    .unwrap();
    assert_eq!(sent[24 + 32..24 + 36], [0x04, 0x00, 0x04, 0x00]);
}

#[test]
fn ptpv2_enable_requires_revision_0738_and_port_readback() {
    let mut older = wing_clock_status(true);
    older[24..26].copy_from_slice(&0x0734u16.to_be_bytes());
    let older = serde_json::to_value(parse_ptp_clock_status(&older).unwrap()).unwrap();
    assert!(!crate::clock_configuration::control_availability(&older).ptpv2_enabled);

    let mut unreported =
        serde_json::to_value(parse_ptp_clock_status(&wing_clock_status(true)).unwrap()).unwrap();
    unreported["ptpv2_enabled"] = serde_json::Value::Null;
    assert!(!crate::clock_configuration::control_availability(&unreported).ptpv2_enabled);

    let control = ClockControl {
        status_revision: Some(0x0734),
        ptpv2_enabled: Some(true),
        ..Default::default()
    };
    assert!(build_clock_control(&control, [0; 6], 1).is_err());
}
