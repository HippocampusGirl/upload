{ pkgs, lib }:
pkgs.buildNpmPackage {
  name = "upload";
  src = pkgs.nix-gitignore.gitignoreSource [ ] ./.;

  nativeBuildInputs = with pkgs; [ python3 ];
  nodejs = pkgs.nodejs_20;

  npmDepsHash = "sha256-H5vJLH3nUR/0X7ul/jbmfh0cxhf3LISLgsc/DukzyA8=";

  doCheck = true;
  checkPhase = ''
    runHook preCheck

    # Remove integration test that needs testcontainers
    rm src/__tests__/integration.test.ts

    npm test

    runHook postCheck
  '';

  meta = with lib; {
    description = "A software for data transfers via the cloud";
    homepage = "https://github.com/HippocampusGirl/upload";
    license = licenses.gpl3Plus;
    platforms = platforms.unix;
  };
}
