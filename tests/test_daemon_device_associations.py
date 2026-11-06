from netaudio.dante.application import DanteApplication
from netaudio.dante.device_serializer import DanteDeviceSerializer


def _daemon_device(**overrides):
    record = {
        "server_name": "WingCompact.local.",
        "name": "WingCompact",
        "ipv4": "10.10.100.224",
        "cmc_process": 0,
        "cmc_process_state": "advertised",
        "cmc_source_identifier": "001dc1fffe8d5d66",
    }
    record.update(overrides)
    return DanteDeviceSerializer.device_from_json(record)


def test_devices_attached_from_the_daemon_receive_conmon_replies():
    application = DanteApplication()
    device = _daemon_device()

    application.attach_devices({device.server_name: device})

    assert device.association_state == "current"
    assert application._device_by_conmon_tuple("001DC1FFFE8D5D66", 0) is device


def test_attached_devices_without_an_advertised_cmc_identity_stay_unassociated():
    application = DanteApplication()
    device = _daemon_device(cmc_process_state="none", cmc_source_identifier=None, cmc_process=None)

    application.attach_devices({device.server_name: device})

    assert device.association_state == "none"
    assert application._device_by_conmon_tuple("001dc1fffe8d5d66", 0) is None
