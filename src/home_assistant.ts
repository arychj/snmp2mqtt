import { Client } from "./mqtt";
import { TargetConfig } from "./types";
import { md5, slugify } from "./util";

export const createHomeAssistantTopics = async (
  mqtt: Client,
  targets: Array<TargetConfig>,
  prefix: string
) => {
  const promises = [];

  for (const target of targets) {
    const device: any = {
      name: target.name ?? target.host,
      identifiers: target.host,
      via_device: "snmp2mqtt",
    };

    if (target.device_manufacturer) {
      device.manufacturer = target.device_manufacturer;
    }

    if (target.device_model) {
      device.model = target.device_model;
    }

    for (const sensor of target.sensors) {
      const topic = `${prefix}/${
        sensor.binary_sensor ? "binary_sensor" : "sensor"
      }/snmp2mqtt/${slugify(sensor.name)}/config`;

      const discovery: any = {
        availability: [
          {
            topic: mqtt.statusTopic,
          },
          {
            topic: mqtt.sensorStatusTopic(sensor, target),
          },
        ],
        availability_mode: "all",
        device,
        name: sensor.name,
        unique_id: `snmp2mqtt.${md5(`${target.host}-${sensor.oid}`)}`,
        state_topic: mqtt.sensorValueTopic(sensor, target),
      };

      if (sensor.unit_of_measurement) {
        discovery.unit_of_measurement = sensor.unit_of_measurement;
      }

      if (sensor.device_class) {
        discovery.device_class = sensor.device_class;
      }

      if (sensor.icon) {
        discovery.icon = sensor.icon;
      }

      promises.push(mqtt.publish(topic, discovery));
    }
  }

  await Promise.all(promises);
};