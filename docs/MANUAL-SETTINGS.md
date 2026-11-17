# Settings to change by hand

The tools cover the layout setup, grids, guides, masters, sections, layers, alternate layouts and styles. The settings below are reached by hand in InDesign. When a task needs one, tell the user what to set, why, and the menu path; carry on with the rest of the task, and list it in the open points until the user confirms it is done.

Menu paths are given as the French interface shows them, then the English one. On macOS, *Préférences* sit under the *InDesign* menu (*InDesign > Réglages* on recent systems) instead of *Édition*. A path ending in *…* opens a dialog; a panel opens from *Fenêtre / Window*.

## Document and pages

| Setting | What it is for | Français | English |
|---|---|---|---|
| Print booklet (imposition) | Pages in printing order for a saddle-stitched or perfect-bound booklet, with creep | Fichier > Imprimer le cahier… | File > Print Booklet… |
| Liquid layout rules per page | How a page's objects adapt when it is resized (beyond the rule chosen in `create_alternate_layout`) | Page > Mise en page liquide (panneau) | Layout > Liquid Layout (panel) |
| Hide a spread | Keep a spread in the file but leave it out of export and print | Page > Pages > Masquer la planche | Layout > Pages > Hide Spread |
| Primary text frame | Master text frame that new pages flow into (long text, books); set when the document is created | Fichier > Nouveau > Document… (Bloc de texte principal) | File > New > Document… (Primary Text Frame) |
| Book | Several documents with continuous page numbering, one table of contents | Fichier > Nouveau > Livre… | File > New > Book… |

## Text and typography

| Setting | What it is for | Français | English |
|---|---|---|---|
| Language of a paragraph style (hyphenation, spelling) | French hyphenation and spelling | Options de style de paragraphe > Formats de caractères avancés > Langue | Paragraph Style Options > Advanced Character Formats > Language |
| Justification of a style | Word and letter spacing, glyph scaling, single-word justification (hyphenation itself is in the style tools) | Options de style de paragraphe > Justification | Paragraph Style Options > Justification |
| Hyphenation exceptions, user dictionary | Words that must not be hyphenated, or only at given points | Édition > Préférences > Dictionnaire… ; Édition > Orthographe > Dictionnaire utilisateur… | Edit > Preferences > Dictionary… ; Edit > Spelling > User Dictionary… |
| Spell check | Before export | Édition > Orthographe > Vérifier l'orthographe… | Edit > Spelling > Check Spelling… |
| Typographer's quotes, text wrap behaviour | Curly quotes while typing | Édition > Préférences > Texte… | Edit > Preferences > Type… |
| Composition highlight | Shows lines that break the H&J rules, substituted fonts and glyphs | Édition > Préférences > Composition… | Edit > Preferences > Composition… |
| Running headers | Chapter title repeated in the header, page by page | Texte > Variables de texte > Définir… ; Texte > Variables de texte > Insérer une variable | Type > Text Variables > Define… ; Type > Text Variables > Insert Variable |
| Table of contents | Generated from paragraph styles | Page > Styles de tables des matières… ; Page > Table des matières… | Layout > Table of Contents Styles… ; Layout > Table of Contents… |
| Cross-references | "see page 12" that follows the pages | Texte > Hyperliens et références croisées > Insérer la référence croisée… | Type > Hyperlinks & Cross-References > Insert Cross-Reference… |
| Footnote options | Numbering, layout of footnotes | Texte > Options de notes de bas de page du document… | Type > Document Footnote Options… |
| Numbered lists across frames | One numbering that continues from frame to frame | Texte > Listes à puces et numérotées > Définir des listes | Type > Bulleted & Numbered Lists > Define Lists |

## Objects

| Setting | What it is for | Français | English |
|---|---|---|---|
| Frame fitting options | How an image fills its frame when the frame is resized | Objet > Ajustement > Options d'ajustement de bloc… | Object > Fitting > Frame Fitting Options… |
| Unlock / show everything on a spread | Objects locked or hidden by hand | Objet > Tout déverrouiller sur la planche ; Objet > Tout afficher sur la planche | Object > Unlock All on Spread ; Object > Show All on Spread |

## Colour and output

| Setting | What it is for | Français | English |
|---|---|---|---|
| Colour settings | Working spaces and conversion for the whole application | Édition > Couleurs… | Edit > Color Settings… |
| Document profiles | RGB and CMYK profiles of this document | Édition > Attribuer des profils… | Edit > Assign Profiles… |
| Transparency blend space | RGB for screen, CMYK for print | Édition > Espace de fusion des transparences | Edit > Transparency Blend Space |
| Separations and ink coverage | Check inks and total ink before print | Fenêtre > Sortie > Aperçu des séparations | Window > Output > Separations Preview |
| Overprint preview | See overprinting as printed | Affichage > Aperçu de la surimpression | View > Overprint Preview |
| PDF export presets | Create or edit a preset (`export_pdf` uses existing ones) | Fichier > Paramètres prédéfinis Adobe PDF > Définir… | File > Adobe PDF Presets > Define… |
| Preflight profiles | Rules the preflight checks (`preflight_document` runs a profile) | Fenêtre > Sortie > Contrôle en amont (menu du panneau > Définir les profils) | Window > Output > Preflight (panel menu > Define Profiles) |

## View and preferences

| Setting | What it is for | Français | English |
|---|---|---|---|
| Screen mode | See the page as printed, or with its bleed | Affichage > Mode de l'écran > Aperçu / Fond perdu | View > Screen Mode > Preview / Bleed |
| Show, hide, lock guides | Guide display while laying out | Affichage > Grilles et repères | View > Grids & Guides |
| Units and increments | Rulers in mm, type in pt, keyboard increments | Édition > Préférences > Unités et incréments… | Edit > Preferences > Units & Increments… |
| Pasteboard and guide colours | Room around the spreads, preview background | Édition > Préférences > Repères et table de montage… | Edit > Preferences > Guides & Pasteboard… |
| Rotate a spread on screen | Work on a landscape spread in a portrait document | Affichage > Faire pivoter la planche | View > Rotate Spread |
