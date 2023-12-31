{
  description = "A basic flake with a shell";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    {
      overlay = import ./overlay.nix { inherit self; };
      nixosModules.upload = import ./module.nix;
    } // flake-utils.lib.eachDefaultSystem (system:
      let
        lib = nixpkgs.lib;
        pkgs = nixpkgs.legacyPackages.${system};

        upload = pkgs.callPackage ./. { };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            awscli
            nodejs_21
            nodePackages.pnpm
            nodePackages.typescript
            nodePackages.typescript-language-server
          ];
        };
        packages = {
          default = upload;
          upload = upload;
        };
      });
}
