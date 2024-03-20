{ pkgs, lib }:
pkgs.buildNpmPackage {
  name = "upload";
  src = pkgs.nix-gitignore.gitignoreSource [ ] ./.;

  nativeBuildInputs = with pkgs; [ python3 ];
  nodejs = pkgs.nodejs_21;

  npmDepsHash = "sha256-vwBuRjORahEthkTx2IGnaxMWNpg6lbtlH2gkCAkQdlo=";

  meta = with lib; {
    description = "A software for data transfers via the cloud";
    homepage = "https://github.com/HippocampusGirl/upload";
    license = licenses.gpl3Plus;
    platforms = platforms.unix;
  };
}
