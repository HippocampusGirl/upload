{
  description = "A basic flake with a shell";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_21;
        buildInputs = with pkgs; [
          awscli
          nodejs
          nodePackages.pnpm
          nodePackages.typescript
          nodePackages.typescript-language-server
        ];
        upload = pkgs.buildNpmPackage {
          inherit buildInputs nodejs;

          name = "upload";
          src = ./.;

          npmDepsHash = "sha256-l3UBJ7rpr9Bb1Dmw8Qgk7YMdEq9NEBQJ+xi09DJFw/c=";

          installPhase = ''
            runHook preInstall
            mkdir --parents $out/bin
            install --mode=555 --target-directory=$out/bin upload.cjs
          '';

          meta = with nixpkgs.lib; {
            description = "A software for data transfers via the cloud";
            homepage = "https://github.com/HippocampusGirl/upload";
            license = licenses.gpl3Plus;
            platforms = platforms.unix;
          };
        };
      in {
        devShells.default = pkgs.mkShell { inherit buildInputs; };
        packages = {
          default = upload;
          upload = upload;
        };
      }) // {
        nixosModules.default = { pkgs, lib, config, ... }:
          let cfg = config.services.upload-server;
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
                    description =
                      "Path to file containing the S3 access key id";
                  };
                  secretAccessKeyFile = mkOption {
                    type = types.path;
                    description =
                      "Path to file containing the S3 secret access key";
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
                  ${pkgs.upload}/bin/upload.cjs serve \
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
                  PrivateDevices = true;
                  PrivateMounts = true;
                  PrivateTmp = true;
                  PrivateUsers = true;
                  ProcSubset = "pid";
                  ProtectClock = true;
                  ProtectControlGroups = true;
                  ProtectHome = true;
                  ProtectHostname = true;
                  ProtectKernelLogs = true;
                  ProtectKernelModules = true;
                  ProtectKernelTunables = true;
                  ProtectProc = "invisible";
                  ProtectSystem = "full";
                  RemoveIPC = true;
                  RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
                  RestrictNamespaces = true;
                  RestrictRealtime = true;
                  RestrictSUIDSGID = true;
                  SystemCallArchitectures = "native";
                  SystemCallFilter = [ "@system-service" "~@privileged" ];
                  UMask = "0077";
                };
              };
            };
          };
      };
}
