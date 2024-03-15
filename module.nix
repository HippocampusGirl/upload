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

      database = {
        type = mkOption {
          type = types.enum [ "sqlite" "postgres" ];
          default = "sqlite";
          description = "Type of database to use";
        };
        path = mkOption {
          type = types.str;
          description = "Database path or URL";
        };
      };
    };
  };
  config = lib.mkIf cfg.enable {
    systemd.services.upload-server = {
      description = "Upload server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ]
        ++ (lib.optional (cfg.database.type == "postgres")
          "postgresql.service");
      script = ''
        export ENDPOINT="$(cat ${cfg.s3.endpointFile})"
        export ACCESS_KEY_ID="$(cat ${cfg.s3.accessKeyIdFile})"
        export SECRET_ACCESS_KEY="$(cat ${cfg.s3.secretAccessKeyFile})"
        ${upload}/bin/upload.cjs serve \
          --port "${toString cfg.port}" \
          --public-key-file "${cfg.publicKeyFile}" \
          --database-type "${cfg.database.type}" \
          --database-path "${cfg.database.path}"
      '';
      serviceConfig = {
        Restart = "on-failure";

        # Hardening based on https://github.com/fort-nix/nix-bitcoin/blob/master/pkgs/lib.nix
        CapabilityBoundingSet = "";
        LockPersonality = true;
        NoNewPrivileges = true;
        # Required for JIT compilation
        MemoryDenyWriteExecute = false;
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

        BindPaths =
          lib.optional (cfg.database.type == "postgres") "/var/run/postgresql";

        RemoveIPC = true;
        RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        SystemCallArchitectures = "native";
        SystemCallErrorNumber = "EPERM";
        SystemCallFilter = [
          "@basic-io"
          "@network-io"
          "@pkey" # Required by nodejs >= 18
          # @system-service is defined in src/shared/seccomp-util.c (systemd source)
          "@system-service"
          "~@privileged"
          "~@resources"
          # docker seccomp blacklist (except for "clone" which is a core requirement for systemd services)
          "~add_key kcmp keyctl mbind move_pages name_to_handle_at personality process_vm_readv process_vm_writev request_key setns unshare userfaultfd"
        ];
        UMask = "0077";
      };
    };
  };
}
