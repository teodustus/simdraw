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
- **P** / "⌖" → probe-verktyg: tap på en ledning eller pin → spänningsmätare, tap på en komponent → strömmätare. Tap igen för att ta bort.
- **E** / "×" → raderverktyg
- **R** → rotera 90°
- **Pinch** → zooma
- **Tryck och håll** → öppna egenskaper / vippa strömställare
- **Esc** → avbryt verktyg, **Del** → ta bort markerad
- **Space** / "▶ Simulera" → kör DC-simulering. Efter ett lyckat resultat animeras strömflödet längs ledningarna automatiskt — fart proportionell mot strömmens storlek.

## Komponentbibliotek (v1)

Batteri, switch, motstånd, kondensator, induktor, lysdiod, diod, NPN, PNP,
NMOS, PMOS, DC-motor, jord (GND), Vcc.

Hovra (på desktop) eller tryck-och-håll (på mobil) på ett komponentchip i
paletten för att se beskrivning, designator och pinnar.

KiCad-symbolimport finns inte ännu — symbolerna är vektor-definierade i
`src/symbols/library.ts`. En build-time-konverter från `.kicad_sym` planeras
för v1.1.

## Demo-kretsar

Klicka på **Demos**-knappen i toolbaren för att öppna inbyggda exempel:

- **Hej LED** — den enklaste belysningskretsen (batteri, switch, motstånd, lysdiod, jord)
- **Spänningsdelare** — två motstånd i serie ger halv batterispänning på mittpunkten
- **Transistor som switch** — en NPN-transistor styrd av en knapp tänder en LED
- **MOSFET-styrd motor** — en NMOS-driver för en likströmsmotor (RC-bil-grunden)

Demoerna verifieras av automatiska tester (`tests/demos.test.ts`) som faktiskt
kör simulatorn och kontrollerar att ström/spänning blir realistiska.

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

## Roadmap / förslag på utbyggnader

Sortering: ungefärligt enkel → svår.

### Quality-of-life
- ✅ **Probe-verktyg**: tap på en ledning visar nodspänningen, tap på en komponent visar dess ström i en flytande etikett
- **Smart wire-routing**: undvika krockar med komponenter automatiskt (A* över griden)
- **Multi-select via lasso**: drag-en-rektangel-markering, gruppflytt, gruppkopiera
- **Kopiera/klistra in**: med klipp­bord-stöd så delar av kretsar kan flyttas mellan flikar
- **Kortkommando-overlay**: håll inne `?` för att se alla snabbkommandon
- **Tema- och rutnätsval**: ljust/mörkt, dot/grid/solid, justerbar gridstorlek
- **Print/PDF-export**: vektor-export av kretsen som SVG eller PDF

### Komponentbibliotek
- **Op-amp** (LM358, ideal): adder, integrator, komparator
- **Spänningsregulator** (78xx, LDO): för att gå från 7,2 V batteri till 5 V logik
- **Logikgrindar** (AND/OR/NOT/XOR/NAND): rena digitala kretsar
- **MCU-block** (Arduino, RP2040): 1-pin-modell där användaren sätter "output high/low" manuellt
- **Servo-modell**: 3-pinns, simulerad som en enkel last
- **H-brygga som färdig kompositkomponent**: drar du in en H-brygga i sin helhet
- **KiCad-symbolimport**: build-time-konverter från `.kicad_sym` så användaren kan ladda valfritt symbolbibliotek

### Simulering
- **Transient simulering**: tids­domän­analys för RC/RL/oscillator-kretsar (ngspice-WASM eller egen Backward-Euler-lösare)
- **AC analys**: småsignal-frekvenssvep för filter och förstärkare
- **Bättre BJT/MOSFET**: linjär aktiv region (Ic = β·Ib), transkonduktans i mättnad
- **Termiska gränser**: varna när effektförlust i en komponent överskrider t.ex. 250 mW
- ✅ **Animerat strömflöde**: pulserande punkter längs ledningarna proportionellt mot ström

### Plattform & samarbete
- **Cloud sync**: GitHub Gist eller en dedikerad backend för delning via länk
- **Realtidssamarbete via WebRTC**: två personer skissar samma krets från olika enheter
- **Capacitor-app**: paketera samma kod till nativ iOS/Android-app
- **AI-tolkning av handritade kretsar**: ladda upp foto, vision-modell ger förslag på netlist

### Bryggor till verklig hårdvara
- **BOM-export**: lista komponenter, värden och eventuella DigiKey/Mouser-länkar
- **PCB-export**: spara som KiCad-PCB-startfil eller netlist till EAGLE
- **Live-koppling till mikrokontroller** via WebUSB/WebSerial: läs in faktiska sensorvärden från en hopkopplad enhet och visa i en virtuell oscilloskop-vy

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
