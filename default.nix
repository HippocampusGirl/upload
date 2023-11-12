{ pkgs, lib, buildInputs, nodejs }: {
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

    meta = with lib; {
      description = "A software for data transfers via the cloud";
      homepage = "https://github.com/HippocampusGirl/upload";
      license = licenses.gpl3Plus;
      platforms = platforms.unix;
    };
  };
}
