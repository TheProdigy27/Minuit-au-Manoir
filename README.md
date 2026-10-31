# 🎃 Minuit au Manoir

Jeu d'horreur **coopératif en ligne**, en **vue subjective**, pour 1 à 8 joueurs, chacun sur son
ordinateur et où qu'il soit. Les joueurs se retrouvent grâce à Steam : aucun réglage de box ni de pare-feu.

> Les bougies se sont éteintes. Quelque chose s'est réveillé.
> Trouvez les crânes maudits, puis fuyez par la grande porte… avant qu'elle ne vous trouve.

## Ce qu'il faut

- Un PC sous **Windows**.
- **Steam** installé, lancé et connecté. Un compte gratuit suffit : rien à acheter ni à installer
  dans Steam. Le jeu passe par *Spacewar*, l'application de test que Valve ouvre à tous les comptes.
- Le fichier **`Minuit-au-Manoir-3.0.0.exe`**, à télécharger sur la page
  [Releases](https://github.com/TheProdigy27/Minuit-au-Manoir/releases/latest). Rien à installer.
  Tout le monde doit avoir la même version : l'hôte refuse les joueurs qui en ont une autre.
  Variante : `Minuit-au-Manoir-3.0.0-win.zip`, le même jeu décompressé, qui démarre plus vite.
  Dézippez-le, puis lancez `Minuit au Manoir.exe` dans le dossier.

## Lancer une partie

1. Chacun lance Steam, puis double-clique sur `Minuit-au-Manoir-3.0.0.exe`. Le jeu met quelques
   secondes à s'ouvrir.
   Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » (le fichier
   n'est pas signé) : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.
2. **L'hôte** clique sur **« Créer une partie »**. Le salon affiche un code, par exemple `3G7K-M2Q` :
   il le partage (Discord, SMS…) ou clique sur **« Inviter des amis Steam »**.
3. **Les autres** saisissent ce code et cliquent sur **« Rejoindre »**. Accepter une invitation
   Steam pendant que le jeu est ouvert fait la même chose.
4. Chacun clique sur **« Je suis prêt·e »**. La partie démarre quand tout le monde est prêt. Une
   nouvelle carte du manoir est générée à chaque partie.

La partie tourne chez l'hôte : s'il quitte, elle s'arrête pour tout le monde. Choisissez de
préférence celui qui a la meilleure connexion.

Pendant la partie, Steam affiche « En jeu : Spacewar » pour tous les joueurs : c'est normal.

## Règles

- 💀 Trouvez les **crânes maudits** cachés dans les pièces (il y en a 4 à 7 selon le nombre de
  joueurs). Leur lueur verte se voit de loin.
- 🚪 Quand ils sont tous trouvés, la **grande porte du hall** s'ouvre : sortez !
- 👁 La créature dort pendant 15 secondes, puis elle chasse. Elle **voit les lampes allumées de
  loin** et **entend ceux qui courent**. Ramasser un crâne fait du bruit, et chaque crâne trouvé
  la rend plus rapide.
- 🔦 Braquez votre lampe sur elle (≈1,5 s) pour la **faire fuir**. À plusieurs, c'est plus
  rapide. Ensuite, elle ne craint plus la lumière pendant quelques secondes.
- 🌑 **Éteignez votre lampe pour vous cacher** : dans le noir, elle ne vous repère que de près.
  Les piles s'usent, ramassez-en.
- ✚ Attrapé·e, on tombe **à terre**. Un ami reste à côté et maintient l'action 3 secondes pour
  vous relever. Sans aide, vous mourez au bout de 50 secondes.
- 👻 Les morts deviennent des **fantômes** : ils traversent les murs, voient la créature à travers
  eux, et laissent des **signes** lumineux pour guider les vivants.
- 🗺 Perdu·e ? Maintenez **M** pour consulter le plan du manoir : il montre les pièces et vos amis,
  mais ni les crânes ni la créature.

La partie se termine quand plus personne n'est debout dans le manoir.

## Commandes

| | |
|---|---|
| Regarder autour de soi, viser avec la lampe | souris |
| Se déplacer | ZQSD ou WASD (avancer, reculer, pas de côté) |
| Avancer et tourner sans la souris | flèches |
| Courir | Maj |
| Allumer / éteindre la lampe | F ou clic droit |
| Relever un ami / signe de fantôme | E ou Espace (maintenir) |
| Plan du manoir | M (maintenir) |
| Suivre un autre joueur (après la fuite) | clic ou Tab |
| Menu : sensibilité de la souris, quitter la partie | Échap |
| Plein écran | F11 |
| Overlay Steam | Maj+Tab |

En partie, la souris est capturée par le jeu. Échap la libère et ouvre le menu ; « Reprendre » ou un
clic dans la fenêtre la recapture.

## Conseils pour la soirée

- Éteignez la lumière et montez le son : toute l'ambiance est sonore (battements de cœur,
  grondements, chuchotements, orage). Avec des écouteurs, c'est encore plus angoissant.
- Le jeu n'a pas de chat vocal : lancez un appel à côté (Discord ou autre).
- Celui qui arrive après le début regarde la partie en spectateur et joue à la manche suivante.
- Si quelqu'un perd la connexion ou ferme le jeu, il a 45 secondes pour revenir avec le même code
  et reprendre sa place.
- La difficulté (Facile, Normal, Cauchemar) se choisit dans le salon. Cauchemar ajoute une
  créature à partir de 3 joueurs.

## En cas de souci

- **« Steam n'est pas lancé »** : lancez Steam, connectez-vous (pas en mode hors ligne), puis
  cliquez sur « Réessayer ».
- **« Impossible de rejoindre cette partie »** : vérifiez le code. La partie est peut-être pleine
  (8 joueurs) ou l'hôte l'a fermée.
- **« L'hôte a la version … »** : tout le monde doit utiliser le même fichier `.exe`.
- **« Impossible de joindre l'hôte » ou « Connexion perdue »** : vérifiez que chacun a internet et
  que Steam est connecté, puis réessayez. Au besoin, l'hôte recrée la partie.
- **L'antivirus bloque le fichier** : c'est un faux positif courant pour les exécutables non
  signés ; autorisez-le.
- **Affichage anormal (écran noir, scintillement)** : faites un raccourci vers le jeu et ajoutez
  ` --sans-overlay` à la fin de sa cible. L'overlay Steam est alors désactivé, et les invitations
  s'ouvrent dans la fenêtre de Steam.
- **Pas de son** : cliquez dans la fenêtre du jeu.
- **La vue tourne trop vite ou trop lentement** : Échap, puis réglez « Sensibilité de la souris ».
- **Le jeu saccade** : il baisse tout seul sa résolution quand l'ordinateur peine. Fermez les autres
  programmes, et branchez le portable sur secteur.

## Pour bidouiller

Il faut [Node.js](https://nodejs.org) 22.12 ou plus récent, et Steam lancé.

```
npm install
npm start          lance le jeu depuis les sources
npm test           teste le réseau avec un faux Steam
npm run dist       fabrique dist/Minuit-au-Manoir-<version>.exe
```

- Tous les réglages (vitesses, portée des lampes, durée des piles, temps pour relever…) sont dans
  [shared/config.js](shared/config.js).
- **Tester seul** : créez une partie, puis appuyez sur **Ctrl+Maj+N** dans le salon. Une fenêtre
  de test s'ouvre : c'est un joueur de plus sur ce PC, sans Steam, toujours prêt. Fermez-la pour le
  retirer. **F12** ouvre les outils de développement.
- Avant de redistribuer une version modifiée, augmentez `version` dans
  [package.json](package.json) : l'hôte n'accepte que les joueurs qui ont la même.
- `dist/win-unpacked/` contient le jeu décompressé : il démarre plus vite que l'exe. On peut le
  zipper et l'envoyer à la place.
- Aucun fichier image ni son à part l'icône : les textures sont dessinées et les sons synthétisés
  par le code. La 3D passe par [three.js](https://threejs.org), installé avec `npm install`.

Le réseau : l'hôte crée un salon Steam public marqué « minuit-au-manoir » et fait tourner la
partie ; le code affiché, c'est l'identifiant de ce salon. Les invités y entrent, puis échangent avec
l'hôte en P2P. Steam traverse les box ou relaie les paquets. L'état du jeu (30 fois par seconde) et
les déplacements partent en envoi non fiable, le reste en envoi fiable.

```
electron/main.js      application : fenêtre, Steam, pont entre la page et le réseau
electron/network.js   salon Steam, code de partie, échanges P2P entre l'hôte et les invités
electron/preload.cjs  ce que la page peut demander à l'application
server/room.js        salon, connexions et reconnexions, début et fin de partie (chez l'hôte)
server/game.js        règles de la partie (crânes, piles, réanimation, sortie)
server/monster.js     intelligence de la créature (vue, ouïe, poursuite, fuite)
shared/               réglages, génération du manoir, collisions (hôte et page)
public/js/render.js   le manoir en 3D (three.js) : murs, meubles, lumières, personnages, créature
public/js/art.js      textures dessinées par le code, et le plan vu de dessus (sol, carte)
public/js/hud.js      interface par-dessus la vue : crânes, équipe, repères, plan, apparitions
public/js/main.js     écrans, réseau, déplacement du joueur, boucle de jeu (+ input.js, audio.js)
test/                 tests du réseau avec un faux Steam
```
