# 🎃 Minuit au Manoir

Jeu d'horreur **coopératif en ligne**, en **vue subjective**, pour 1 à 8 joueurs, chacun sur son
ordinateur et où qu'il soit. Les joueurs se retrouvent grâce à Steam : aucun réglage de box ni de pare-feu.

> Les bougies se sont éteintes. Quelque chose s'est réveillé.
> Trouvez les crânes maudits, puis fuyez par la grande porte… avant qu'elle ne vous trouve.

## Ce qu'il faut

- Un PC sous **Windows**.
- **Steam** installé, lancé et connecté. Un compte gratuit suffit : rien à acheter ni à installer
  dans Steam. Le jeu passe par *Spacewar*, l'application de test que Valve ouvre à tous les comptes.
- Le fichier **`Minuit-au-Manoir-3.6.0.exe`**, à télécharger sur la page
  [Releases](https://github.com/TheProdigy27/Minuit-au-Manoir/releases/latest). Rien à installer.
  Tout le monde doit avoir la même version : l'hôte refuse les joueurs qui en ont une autre.
  Le jeu se met à jour tout seul (voir [Mises à jour](#mises-à-jour)).
  Variante : `Minuit-au-Manoir-3.6.0-win.zip`, le même jeu décompressé, qui démarre plus vite.
  Dézippez-le, puis lancez `Minuit au Manoir.exe` dans le dossier.

## Mises à jour

Au lancement, le jeu regarde s'il existe une version plus récente sur la page Releases. Si oui, il
la télécharge pendant qu'on est sur l'écran titre, puis propose **« Redémarrer et mettre à jour »** :
un clic, et le jeu se rouvre dans la nouvelle version.

- Avec l'exe, la nouvelle version arrive dans le même dossier, sous son nouveau nom (par exemple
  `Minuit-au-Manoir-3.7.0.exe`), et l'ancienne est effacée. Un raccourci vers l'ancien fichier est
  à refaire.
- Avec le zip, le dossier du jeu est mis à jour sur place.
- Si le jeu n'a pas le droit d'écrire dans son dossier, le bouton ouvre la page de téléchargement.

Le jeu revérifie toutes les 30 minutes. Pour ne pas attendre, ouvrez les **Options** (onglet Jeu) : elles
affichent la version installée, et **« Rechercher une mise à jour »** interroge GitHub tout de suite.

## Lancer une partie

1. Chacun lance Steam, puis double-clique sur `Minuit-au-Manoir-3.6.0.exe`. Le jeu met quelques
   secondes à s'ouvrir.
   Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » (le fichier
   n'est pas signé) : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.
2. **L'hôte** clique sur **« Créer une partie »**. Le salon affiche un code, par exemple `3G7K-M2Q` :
   il le partage (Discord, SMS…) ou clique sur **« Inviter des amis Steam »**.
3. **Les autres** saisissent ce code et cliquent sur **« Rejoindre »**. Accepter une invitation
   Steam pendant que le jeu est ouvert fait la même chose.
4. Chacun clique sur **« Je suis prêt·e »**. La partie démarre quand tout le monde est prêt. Une
   nouvelle carte du manoir est générée à chaque partie : un rez-de-chaussée et un premier étage,
   plus un sous-sol à partir de 3 joueurs, et des étages plus vastes à partir de 5.

La partie tourne chez l'hôte : s'il quitte, elle s'arrête pour tout le monde. Choisissez de
préférence celui qui a la meilleure connexion.

Pendant la partie, Steam affiche « En jeu : Spacewar » pour tous les joueurs : c'est normal.

## Règles

- 💀 Trouvez les **crânes maudits** cachés dans les pièces (il y en a 4 à 7 selon le nombre de
  joueurs), répartis sur **tous les étages**. Leur lueur verte se voit de loin.
- 🪜 Les étages sont reliés par des **escaliers** (deux entre chaque étage et le suivant).
- 🚪 Quand ils sont tous trouvés, la **grande porte du hall** s'ouvre : sortez !
- 👁 La créature dort pendant 15 secondes, puis elle chasse (à partir de 3 joueurs, elles sont
  deux). Elle **voit les lampes allumées de loin**, **entend ceux qui courent** et **ceux qui
  parlent** (voir le chat vocal), et elle prend les escaliers aussi. Ramasser un crâne fait du bruit, qui s'entend jusqu'à l'étage voisin, et
  chaque crâne trouvé la rend plus rapide.
- 🔦 Braquez votre lampe sur elle (≈1,5 s) pour la **faire fuir**. À plusieurs, c'est plus
  rapide. Ensuite, elle ne craint plus la lumière pendant quelques secondes.
- 🌑 **Éteignez votre lampe pour vous cacher** : dans le noir, elle ne vous repère que de près.
  Les piles s'usent, ramassez-en.
- 🚪 **Cachettes** : armoires, buffets, dessous des lits, cercueils de la crypte (il y en a dans au
  moins une pièce sur deux, à chaque étage). Face au meuble, **E** pour s'y glisser (la lampe
  s'éteint), **E** pour en sortir. Un léger contour doré signale les cachettes proches et s'allume
  sur celle que vous visez (bleuté si quelqu'un s'y cache déjà). Cachée, la créature ne vous voit pas et **ne peut pas vous
  attraper**… sauf si elle vous a vu·e y entrer, ou si elle vous **entend de tout près** (votre voix,
  la porte qui grince) : elle vient alors vous en tirer. De plus loin, elle vient seulement voir devant
  la porte : retenez votre souffle, elle finira par repartir. Une personne par cachette ; un ami peut
  vous sauver en braquant sa lampe sur elle avant qu'elle n'ouvre la porte.
- ✚ Attrapé·e, on tombe **à terre**. Un ami reste à côté et maintient l'action 3 secondes pour
  vous relever. Sans aide, vous mourez au bout de 50 secondes.
- 👻 Les morts deviennent des **fantômes** : ils traversent les murs, voient la créature à travers
  eux, et laissent des **signes** lumineux pour guider les vivants.
- 🎙 Le **chat vocal de proximité** est intégré : on n'entend que les joueurs proches, de plus en
  plus faiblement jusqu'à une vingtaine de pas, et sur le côté d'où vient leur voix. Les murs
  l'étouffent, l'étage voisin encore plus. Les fantômes, eux, ne parlent qu'aux autres fantômes (et à
  ceux qui ont fui) : pour aider les vivants, il leur reste les signes. Au salon et à la fin de la
  partie, tout le monde s'entend.
- 🤫 **La créature entend aussi les voix.** Une voix normale porte à quelques pas (moins loin qu'une
  course), deux fois plus loin à chaque fois qu'on hausse le ton, et **un cri s'entend à travers les
  murs, jusqu'à l'étage voisin**. Un murmure, elle ne l'entend pas. Même à terre, appeler à l'aide
  peut la faire revenir.
- 🗺 Perdu·e ? Maintenez **Tab** pour consulter le plan de l'étage où vous êtes : il montre les
  pièces, les escaliers et l'étage où ils mènent, et vos amis (ceux des autres étages sont nommés
  dessous), mais ni les crânes ni la créature. En permanence, une **mini-carte** en bas à droite
  montre les alentours, tournée dans le sens de votre regard (on peut la masquer dans les options).

La partie se termine quand plus personne n'est debout dans le manoir.

## Commandes

| | |
|---|---|
| Regarder autour de soi, viser avec la lampe | souris |
| Se déplacer | ZQSD (WASD en QWERTY) : avancer, reculer, pas de côté |
| Avancer et tourner sans la souris | flèches |
| Courir | Maj |
| Allumer / éteindre la lampe | F ou clic droit |
| Relever un ami / signe de fantôme | E ou Espace (maintenir) |
| Se cacher (face à une armoire, un lit…) / sortir de sa cachette | E ou Espace |
| Plan du manoir | Tab (maintenir) |
| Parler, en mode « appuyer pour parler » | V (maintenir) |
| Suivre un autre joueur (après la fuite) | clic |
| Menu : options (son, chat vocal, souris, touches, graphismes, affichage, mises à jour), quitter la partie ou le jeu | Échap |
| Passer du plein écran à la fenêtre, et inversement | F11 |
| Overlay Steam | Maj+Tab |

Toutes ces touches se changent dans **Échap › Options › Commandes** (deux par action, boutons de la
souris compris : un bouton de côté pour parler, par exemple). Cliquez sur une case, puis appuyez sur
la touche voulue ; une touche déjà prise ailleurs y est retirée. Échap, F11 et le clic gauche restent
réservés. Le jeu nomme les touches selon votre clavier (AZERTY, QWERTY…), dans les options comme dans
les indications à l'écran.

En partie, la souris est capturée par le jeu. Échap la libère et ouvre le menu ; « Reprendre » ou un
clic dans la fenêtre la recapture.

Le jeu s'ouvre en plein écran. Les options (onglet Graphismes) proposent aussi le **plein écran
fenêtré**, qui reste affiché quand on passe à une autre application (pratique avec deux écrans), et
le mode **fenêtré**. Le choix est gardé pour les prochaines fois.

La **qualité graphique** se choisit dans le même onglet : **Auto** (par défaut : Haute, baissée toute
seule si les images ralentissent), **Basse**, **Moyenne**, **Haute** ou **Ultra**, ou chaque détail à
la main : résolution 3D (de 50 à 100 %), lissage des bords, ombres, éclairage par les bougies, faisceau
de la lampe dans l'air, halo des lumières, filtrage des textures. Tout s'applique aussitôt, même en
partie, et le menu montre alors les images par seconde du moment. On y limite aussi les images par
seconde : 30, 60 (par défaut) ou autant que l'écran (120 Hz, 144 Hz…).

Le chat vocal se règle dans les options : **activation vocale** (par défaut : le micro s'ouvre quand
on parle, au-dessus d'un seuil que l'on règle en regardant la barre de niveau), **appuyer pour parler** (V), ou
**micro coupé** (on entend toujours les autres). On y choisit aussi le micro et le volume des voix.
Un anneau vert autour de la pastille d'un joueur (en haut à gauche, ou dans le salon) montre qu'il
parle, et qu'on l'entend. Autour de la vôtre, en partie, il vire à l'**orange** quand la créature vous
entend d'aussi loin que si vous couriez, et au **rouge** quand vous criez (un avertissement s'affiche
alors en bas de l'écran).

Ce qui compte, c'est votre voix comparée à votre façon habituelle de parler, apprise en quelques
minutes de conversation (au salon, par exemple) et gardée pour ce micro d'une fois sur l'autre : un
micro sensible ne vous rend pas plus bruyant·e qu'un autre. Pour jouer en restant dans un appel
Discord, choisissez « micro coupé » : sinon, la créature entend aussi ce que vous dites dans l'appel.

## Conseils pour la soirée

- Éteignez la lumière et montez le son : toute l'ambiance est sonore (battements de cœur,
  grondements, chuchotements, orage). Avec des écouteurs, c'est encore plus angoissant.
- Coupez un éventuel appel Discord pendant la partie : le chat vocal du jeu ne porte qu'à quelques
  pas, c'est tout l'intérêt. Avec un casque, on entend mieux d'où viennent les voix.
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
- **« L'hôte a la version … »** : tout le monde doit avoir la même version. Celui qui a l'ancienne
  attend sur l'écran titre que la nouvelle soit téléchargée, puis clique sur « Redémarrer et mettre
  à jour ».
- **« Impossible de joindre l'hôte » ou « Connexion perdue »** : vérifiez que chacun a internet et
  que Steam est connecté, puis réessayez. Au besoin, l'hôte recrée la partie.
- **L'antivirus bloque le fichier** : c'est un faux positif courant pour les exécutables non
  signés ; autorisez-le.
- **Affichage anormal (écran noir, scintillement)** : faites un raccourci vers le jeu et ajoutez
  ` --sans-overlay` à la fin de sa cible. L'overlay Steam est alors désactivé, et les invitations
  s'ouvrent dans la fenêtre de Steam.
- **Pas de son** : cliquez dans la fenêtre du jeu.
- **Les autres ne m'entendent pas** : Échap, Options, Son et voix. La barre sous « Seuil de l'activation vocale »
  doit dépasser le trait rouge quand vous parlez (sinon, baissez le seuil ou choisissez un autre
  micro). Si un message dit que Windows bloque le micro : Paramètres Windows › Confidentialité et
  sécurité › Microphone, autorisez les applications de bureau à y accéder.
- **On m'entend en écho** : quelqu'un joue sur haut-parleurs ; un casque règle le problème.
- **La vue tourne trop vite ou trop lentement** : Échap, Options, Commandes : réglez « Sensibilité de la
  souris ».
- **Le jeu saccade** : en qualité Auto, le jeu coupe tout seul le lissage des bords, puis baisse sa
  résolution. Sinon, Échap › Options › Graphismes : essayez « Moyenne » ou « Basse », ou baissez
  d'abord la résolution 3D et le lissage des bords (ce sont eux qui comptent le plus). Fermez les
  autres programmes, et branchez le portable sur secteur.

## Pour bidouiller

Il faut [Node.js](https://nodejs.org) 22.12 ou plus récent, et Steam lancé.

```
npm install
npm start          lance le jeu depuis les sources
npm test           teste le réseau (faux Steam) et la mise à jour (faux GitHub)
npm run dist       fabrique dist/Minuit-au-Manoir-<version>.exe
```

- Tous les réglages (vitesses, portée des lampes, durée des piles, temps pour relever…) sont dans
  [shared/config.js](shared/config.js).
- **Tester seul** : créez une partie, puis appuyez sur **Ctrl+Maj+N** dans le salon. Une fenêtre
  de test s'ouvre : c'est un joueur de plus sur ce PC, sans Steam, toujours prêt. Fermez-la pour le
  retirer. **F12** ouvre les outils de développement.
- **Publier une mise à jour** : augmentez `version` dans [package.json](package.json) (l'hôte
  n'accepte que les joueurs qui ont la même), `npm run dist`, puis créez une release GitHub avec le
  tag `v<version>` (par exemple `v3.7.0`) et deux fichiers : l'exe, et le zip de `dist/win-unpacked`
  (son nom doit finir par `-win.zip`). Les jeux déjà installés la trouvent tout seuls : ils regardent
  la dernière release publiée (ni brouillon ni préversion) et reconnaissent les fichiers à leur nom.
- `dist/win-unpacked/` contient le jeu décompressé : il démarre plus vite que l'exe. On peut le
  zipper et l'envoyer à la place.
- Les polices de l'interface (Pirata One, Cinzel, EB Garamond, sous licence SIL OFL : voir
  [public/fonts/OFL.txt](public/fonts/OFL.txt)) sont livrées avec le jeu : pas besoin d'internet.
- Les matières (bois, pierre, plâtre, tissus, métal…) sont des photographies du domaine public
  ([Poly Haven](https://polyhaven.com), voir [public/textures/CREDITS.md](public/textures/CREDITS.md)),
  mêlées aux motifs dessinés par le code. La 3D passe par [three.js](https://threejs.org), installé
  avec `npm install`.

Le réseau : l'hôte crée un salon Steam public marqué « minuit-au-manoir » et fait tourner la
partie ; le code affiché, c'est l'identifiant de ce salon. Les invités y entrent, puis échangent avec
l'hôte en P2P. Steam traverse les box ou relaie les paquets. L'état du jeu (30 fois par seconde) et
les déplacements partent en envoi non fiable, le reste en envoi fiable.

La voix : la page encode le micro en Opus (WebCodecs, trames de 40 ms à 20 kbit/s) et l'envoie à
l'hôte en non fiable ; l'hôte ne la relaie qu'à ceux qui peuvent l'entendre (même étage ou voisin, à
portée, et pas des morts vers les vivants : `hears` dans [server/room.js](server/room.js)). Chaque
page règle ensuite le volume, l'étouffement par les murs et la direction (HRTF) à chaque image.
Chaque trame porte aussi son niveau : l'hôte en fait un bruit pour la créature (`voice` dans
[server/game.js](server/game.js), portée `voiceNoise` dans [shared/config.js](shared/config.js)). Ce
niveau se mesure sur un second flux du micro, brut, comparé à la voix habituelle du joueur : le réglage
automatique du gain de Chrome, qui rehausse peu à peu une voix basse, fausserait le son envoyé.

```
electron/main.js      application : fenêtre, Steam, pont entre la page et le réseau
electron/network.js   salon Steam, code de partie, échanges P2P entre l'hôte et les invités
electron/preload.cjs  ce que la page peut demander à l'application
electron/update.js    mise à jour automatique depuis les releases GitHub
server/room.js        salon, connexions et reconnexions, début et fin de partie (chez l'hôte)
server/game.js        règles de la partie (crânes, piles, réanimation, sortie)
server/monster.js     intelligence de la créature (vue, ouïe, poursuite, fuite)
shared/               réglages, génération du manoir et de ses étages, collisions, escaliers (hôte et page)
public/js/render.js   le manoir en 3D (three.js) : murs, meubles, lumières, personnages, créature
public/js/materials.js matières photographiées (rendu physique), posées à l'échelle réelle
public/js/bc.js       photos compressées pour la carte graphique (dans texworker.js, hors du fil principal)
public/js/post.js     développement de l'image : halo des lumières, faisceau dans l'air, grain
public/js/quality.js  qualité graphique : préréglages et détails des options, limite d'images par seconde
public/js/art.js      motifs dessinés par le code (murs, meubles, tapis…) et plan vu de dessus
public/textures/      photos des matières (Poly Haven, domaine public)
public/fonts/         polices de l'interface (gothique pour les titres, capitales gravées, Garamond)
public/js/hud.js      interface par-dessus la vue : crânes, équipe, repères, mini-carte, plan, apparitions
public/js/main.js     écrans, options, réseau, déplacement du joueur, boucle de jeu (+ audio.js)
public/js/input.js    clavier et souris : actions, touches choisies dans les options, noms selon le clavier
public/js/voice.js    chat vocal : micro (voice-worklet.js), encodage Opus, voix des autres placées dans le manoir
test/                 tests du réseau (faux Steam), de la mise à jour (faux GitHub), du manoir à étages,
                      des cachettes, des touches et de la qualité graphique
```
