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
        nixosModules.upload = import ./nixos.nix;
      };
}
