{ pkgs, lib }:
pkgs.buildNpmPackage {
  name = "upload";
  src = ./.;

  nativeBuildInputs = with pkgs; [ python3 ];
  nodejs = pkgs.nodejs_21;

  npmDepsHash = "sha256-J+zm4Uhtz5SzUWDBw0aSOgWjG/cy6+IFKoQaCJv33Gc=";

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
