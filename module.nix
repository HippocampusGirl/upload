{ pkgs, lib, config, ... }:
let
  cfg = config.services.upload-server;
  upload = pkgs.callPackage ./. { };
in {
  options = with lib; {
    services.upload-server = {
      enable = mkEnableOption "Enable upload server";

      port = mkOption {
        type = types.int;
        default = 3000;
        description = "Port to listen on";
      };

      publicKeyFile = mkOption {
        type = types.path;
        description = "Path to public key file";
      };

      s3 = {
        endpointFile = mkOption {
          type = types.path;
          description = "Path to file containing the S3 endpoint";
        };
        accessKeyIdFile = mkOption {
          type = types.path;
          description = "Path to file containing the S3 access key id";
        };
        secretAccessKeyFile = mkOption {
          type = types.path;
          description = "Path to file containing the S3 secret access key";
        };
      };
    };
  };
  config = lib.mkIf cfg.enable {
    systemd.services.upload-server = {
      description = "Upload server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      script = ''
        export ENDPOINT="$(cat ${cfg.s3.endpointFile})"
        export ACCESS_KEY_ID="$(cat ${cfg.s3.accessKeyIdFile})"
        export SECRET_ACCESS_KEY="$(cat ${cfg.s3.secretAccessKeyFile})"
        ${upload}/bin/upload.cjs serve \
          --port "${toString cfg.port}" \
          --public-key-file "${cfg.publicKeyFile}"
      '';
      serviceConfig = {
        Restart = "on-failure";
        Type = "oneshot";

        # Hardening
        CapabilityBoundingSet = "";
        LockPersonality = true;
        NoNewPrivileges = true;
        MemoryDenyWriteExecute = true;
        ProcSubset = "pid";

        ProtectSystem = "full";
        ProtectHome = true;
        PrivateDevices = true;
        PrivateMounts = true;
        PrivateTmp = true;
        PrivateUsers = true;
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectProc = "invisible";

        RemoveIPC = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        SystemCallArchitectures = "native";
        SystemCallFilter =
          [ "@network-io" "@system-service" "~@privileged" "~@resources" ];
        UMask = "0077";
      };
    };
  };
}
