{ pkgs, lib }:
pkgs.buildNpmPackage {
  name = "upload";
  src = pkgs.nix-gitignore.gitignoreSource [ ] ./.;

  nativeBuildInputs = with pkgs; [ python3 ];
  nodejs = pkgs.nodejs_20;

  npmDepsHash = "sha256-kCw3yVdlvuQaqZtqBabGEVsD6JmxXsYTKZq1Skz9yAU=";

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
