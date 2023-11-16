{ pkgs, lib }:
pkgs.buildNpmPackage {
  name = "upload";
  src = ./.;

  npmDepsHash = "sha256-56iVbkP/fC76B9/miZLBwX6tHt+iTOG4FJT44s3/4Nc=";

  installPhase = ''
    runHook preInstall
    mkdir --parents $out/bin
    install --mode=555 --target-directory=$out/bin upload.cjs
  '';

  meta = with lib; {
    description = "A software for data transfers via the cloud";
    homepage = "https://github.com/HippocampusGirl/upload";
    license = licenses.gpl3Plus;
    platforms = platforms.unix;
  };
}
