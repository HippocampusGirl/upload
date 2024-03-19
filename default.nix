{ pkgs, lib }:
pkgs.buildNpmPackage {
  name = "upload";
  src = ./.;

  nativeBuildInputs = with pkgs; [ python3 ];
  nodejs = pkgs.nodejs_21;

  npmDepsHash = "sha256-NXsHg6u2dO7XOsbuzo8q+viFDYBGa0l+tbWwPde8ufY=";

  meta = with lib; {
    description = "A software for data transfers via the cloud";
    homepage = "https://github.com/HippocampusGirl/upload";
    license = licenses.gpl3Plus;
    platforms = platforms.unix;
  };
}
