# SimDraw

Mobilanpassad krets-CAD i webläsaren. Ritar enkla likströmskretsar med
WebGL2-rendering, snap-to-grid, touch-gester och en inbyggd DC-simulator
(modifierad nodal-analys) som bygger en RC-bil i tankarna.

## Komma igång

```bash
npm install
npm run dev      # startar på http://localhost:5173
npm run build    # produktionsbygge
```

Öppna `http://<din-ip>:5173` på telefonen i samma nätverk för att testa
touch-flödet. Appen är installerbar som PWA.

## Kontroller

- **Tap** på komponentchip → välj komponent
- **Tap** på arbetsytan → placera komponent
- **W** / "〰" → ledningsverktyg (klicka pin → klicka pin)
- **S** / "✦" → markeringsverktyg (drag för att flytta, drag tomt för att panorera)
- **E** / "×" → raderverktyg
- **R** → rotera 90°
- **Pinch** → zooma
- **Tryck och håll** → öppna egenskaper / vippa strömställare
- **Esc** → avbryt verktyg, **Del** → ta bort markerad
- **Space** / "▶ Simulera" → kör DC-simulering

## Komponentbibliotek (v1)

Batteri, switch, motstånd, kondensator, induktor, lysdiod, diod, NPN, PNP,
NMOS, PMOS, DC-motor, jord (GND), Vcc.

KiCad-symbolimport finns inte ännu — symbolerna är vektor-definierade i
`src/symbols/library.ts`. En build-time-konverter från `.kicad_sym` planeras
för v1.1.

## Simulator

`simulateDC()` bygger upp en netlist från komponentpinnar + ledningar via
union-find, och löser MNA iterativt med växlande dioder och
transistor-tillstånd:

- Dioder/lysdioder: PWL-modell (Vf-källa + serieresistans när ledande, annars öppen)
- BJT (NPN/PNP): cutoff / saturation (VBE_ON ≈ 0.65 V, VCE_SAT ≈ 0.2 V)
- MOSFET: switch-modell baserat på Vgs vs Vth
- Strömställare: 1 mΩ stängd / 1 GΩ öppen
- Kondensator → öppen, Induktor → kortslutning vid DC

Begränsningar: ingen transient, ingen AC, ingen styrd källa (BJT-βC*Ib är
inte modellerad — transistorn kan vara av eller mätta inte i aktiv regim).
Tillräckligt för "tänd lysdioden via en transistor" och liknande
RC-bil-grundkretsar.

## Arkitektur

- `src/render/` — WebGL2 (grid + batched lines/triangles + 2D-canvas-överlagring för text)
- `src/symbols/library.ts` — vektor-symboler + pinpositioner
- `src/circuit/` — datamodell + redigeringshjälp
- `src/sim/netlist.ts` — union-find över grid-punkter
- `src/sim/dc.ts` — iterativ MNA-lösare
- `src/sim/linsolve.ts` — tät LU med pivotering
- `src/input/pointer.ts` — tap/long-press/drag/pinch/wheel
- `src/ui/` — toolbar, palette, properties-panel
- `src/storage/` — localStorage + JSON export/import
