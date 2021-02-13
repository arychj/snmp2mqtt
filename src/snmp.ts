import * as snmp from "net-snmp";
import * as safeEval from "safe-eval";

import { SensorConfig, TargetConfig, Version } from "./types";
import { EventEmitter } from "events";
import { Logger, LogLevel } from "./log";
import { toBigIntBE } from "bigint-buffer";

const versionToNetSnmp = (version: Version) => {
  switch (version) {
    case Version.Version3:
      return snmp.Version3 as number;
    case Version.Version2c:
      return snmp.Version2c as number;
    case Version.Version1:
      return snmp.Version1 as number;
  }
};

export declare interface Target {
  on(
    event: "error",
    listener: (error: Error, sensor: SensorConfig, target: TargetConfig) => void
  ): this;
  on(
    event: "response",
    listener: (
      value: string | number | bigint,
      sensor: SensorConfig,
      target: TargetConfig
    ) => void
  ): this;
}

export class Target extends EventEmitter {
  private session: any;
  private interval?: NodeJS.Timer;

  public constructor(private options: TargetConfig, private log: Logger) {
    super();
  }

  public connect() {
    const scanIntervalMs = (this.options.scan_interval ?? 10) * 1000;
    const version = this.options.version ?? Version.Version1;

    const options: any = {
      port: this.options.port ?? 161,
      retries: 3,
      timeout: scanIntervalMs > 5000 ? 5000 : scanIntervalMs / 2,
      backoff: 1.0,
      version: versionToNetSnmp(version),
    };

    if (version === Version.Version3) {
      const user: any = {
        name: this.options.username,
      };

      if (this.options.auth_key && this.options.priv_key) {
        user.level = snmp.SecurityLevel.authPriv;
      } else if (this.options.auth_key && !this.options.priv_key) {
        user.level = snmp.SecurityLevel.authNoPriv;
      } else {
        user.level = snmp.SecurityLevel.noAuthNoPriv;
      }

      if (this.options.auth_protocol) {
        user.authProtocol = snmp.AuthProtocols[this.options.auth_protocol];
      }
      if (this.options.auth_key) {
        user.authKey = this.options.auth_key;
      }

      if (this.options.priv_protocol) {
        user.privProtocol = snmp.PrivProtocols[this.options.priv_protocol];
      }
      if (this.options.priv_key) {
        user.privKey = this.options.priv_key;
      }

      this.session = snmp.createV3Session(this.options.host, user, options);
    } else {
      const community = this.options.community ?? "public";
      this.session = snmp.createSession(this.options.host, community, options);
    }

    this.session.on("close", () => {
      this.log(LogLevel.WARNING, `Target ${this.options.host} disconnected`);

      if (this.interval) {
        clearInterval(this.interval);
      }

      setTimeout(() => {
        this.connect();
      }, 2000);
    });
    //this.session.on("")

    this.interval = setInterval(() => {
      this.fetch();
    }, scanIntervalMs);

    this.fetch();
  }

  public close() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private fetch() {
    const oids = this.options.sensors.map((sensor) => sensor.oid);

    this.log(
      LogLevel.DEBUG,
      `Fetching ${oids.length} sensors from ${this.options.host}...`
    );

    this.session.get(
      oids,
      (error: Error, varbinds: Array<{ value: string | number }>) => {
        if (error) {
          for (const sensor of this.options.sensors) {
            this.emit("error", error, sensor, this.options);
          }
        } else {
          for (const i in this.options.sensors) {
            const sensor = this.options.sensors[i];
            const result = varbinds[i];

            if (snmp.isVarbindError(result)) {
              this.emit(
                "error",
                snmp.varbindError(result),
                sensor,
                this.options
              );
            } else {
              let { value, type } = result as {
                value: string | number | Buffer | bigint;
                type: any;
              };

              switch (type) {
                case snmp.ObjectType.Counter64:
                  value = toBigIntBE(value as Buffer);
                  break;
                case snmp.ObjectType.OctetString:
                  value = value.toString();
                  break;
              }

              if (sensor.transform) {
                value = safeEval(sensor.transform, { value });
              }

              this.emit("response", value, sensor, this.options);
            }
          }
        }
      }
    );
  }
}