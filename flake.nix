{
  description = "A basic flake with a shell";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        lib = nixpkgs.lib;
        pkgs = nixpkgs.legacyPackages.${system};

        nodejs = pkgs.nodejs_21;
        buildInputs = with pkgs; [
          awscli
          nodejs
          nodePackages.pnpm
          nodePackages.typescript
          nodePackages.typescript-language-server
        ];
        upload = pkgs.callPackage ./. { inherit buildInputs nodejs; };
      in {
        devShells.default = pkgs.mkShell { inherit buildInputs; };
        packages = {
          default = upload;
          upload = upload;
        };
      }) // {
        overlay = final: prev: {
          upload = final.callPackage ./default.nix { };
        };
        nixosModules.upload = import ./nixos.nix;
      };
}
