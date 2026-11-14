[한국어](README.md)

# color-longform-kit: an 80-second video template for your own character

Put in a drawing of your character and this kit makes an 80-second 1920×1080 video with music, colored from that character's own palette.
It is the code and process behind "WHAT YOUR COLOR.", a longform video on the YouTube channel 아낌없이 주는 두루 ("Duru, who gives it all away"). The character slot is open, so your drawing goes where Duru was.
A 20-second vertical short with the same story is in [color-short-kit](https://github.com/uncle-sheepsky/color-short-kit).

- The original video made with this code: https://youtu.be/2T3t7NSwQis

## In the browser, with one image
There is also a [web page](https://uncle-sheepsky.github.io/color-longform-kit/web/) that needs no install. Drop in one transparent PNG. It pulls the colors out of your drawing and shows you how it split them, and you can change them there. Then it renders the video right in the browser tab with the same animation and music. Your image stays on your computer.
- You can download the full 80 seconds at 1920×1080. The vertical cut runs from the drop to the end (34.7 seconds) and comes as 1080×1920 for vertical feeds like Shorts and Reels, or as 1080×1350 for an Instagram post.
- Use a recent Chrome or Edge. On the computer this kit was built on, the 16:9 and 9:16 videos took about 40 seconds together. Details and known limits are in [`web/README.md`](web/README.md) (in Korean).
- The 「두루로 해 보기」 button (try it with Duru) runs the page with the channel's own character first. That image (`web/duru.png`) is for trying the page only and is not CC0. See [`NOTICE`](NOTICE).
- For several poses, or for the check report, use the Python version below.

If you use an AI coding tool (Claude Code, Codex and so on), give it this repository and paste one of the prompts below. The steps the AI follows, and what it checks after each one, are in [`AGENTS.md`](AGENTS.md). That file is in Korean. AI tools read it fine.

## What you get
Your character starts as bare line art and gets its own colors back one at a time over 80 seconds (180 BPM, 240 beats).

| Part | Time | On screen |
|---|---|---|
| 1 Line art | 0:00-0:08 | A glowing pen traces the character's lines in the dark. The body fills with paper color. For two frames the real colors flash and vanish. |
| 2 Someone else's colors | 0:08-0:18.7 | Every two beats it tries on a color that isn't its own. A disc pops in behind it and the color rises from the feet. Faint code scrolls by and rhythm-game notes land on its head. |
| 3 Its own colors | 0:18.7-0:36.7 | Its own colors come back one by one (k1, k2, k3). The framing changes on the beat: full body, giant name, picture-in-picture, face close-up, grids, halftone. Icons fall and pile up. |
| 4 Wrong places, finding the places, stillness | 0:36.7-0:45.3 | Colors land on the wrong body parts. Then the color pieces fly in and try to snap back where they belong, and click. 1.2 seconds of silence follow. |
| 5 Drop, worlds inside a disc | 0:45.3-0:57.3 | Every original color at once with an orbit of icons. Inside a disc there is Tetris, and the middle of the Tetris board opens into a black hole. |
| 6 Light | 0:57.3-1:05.3 | A silhouette surrounded by a galaxy of light. The particles get pulled into a sun and the whole screen turns orange. |
| 7-8 End card | 1:05.3-1:20 | The end card (laid out like the thumbnail) builds itself piece by piece. A clap. The title comes in one letter at a time and everything settles to a stop. |

- Colors come from your drawing automatically. The darkest one becomes the line color and the bright, wide one becomes paper. A dark fill gets its own layer if there is one. The three most saturated colors become k1, k2 and k3, which are the ones that come back one by one.
- `music/color_longform.wav` was written for this exact structure, with real instrument recordings from VSCO 2 Community Edition (CC0). The code that builds it is `music/build_music.py`. Events on screen sit on the beats of this track.
- Each frame is a pure function of its frame number. The same input gives the same pixels: every part is drawn front to back and again back to front, and the per-frame hashes have to agree.

## Requirements
- Node.js 18 or newer, then `npm install`
- Once: `npx playwright install chromium`
- Python 3.10 or newer, then `pip install -r requirements.txt` (numpy, pillow, scipy, pyloudnorm)
- ffmpeg, with `ffmpeg` and `ffprobe` working from the command line

## Try the sample character first
MOMO is a test character drawn in code. If it goes all the way through, your setup is fine.
```bash
python examples/make_sample_character.py
python make.py all --character examples/sample
```
You get `out/color_longform.mp4` and a report in `gates/report.json` that should say `"all_pass": true`. Rendering takes most of the time. On the computer this kit was built on, setup took about a minute and `make.py all` about 14 minutes.

## Using your own character
1. Add the character as transparent PNGs in `character/<pose name>/00.png, 01.png …`. **One image is enough** (`character/main/00.png`). If you add several poses, different scenes use different ones. [`character/README.md`](character/README.md) has the table of which scene uses which pose (in Korean; the pose slot names are English).
2. Set the name and title in `config.json`. `name` is used for the giant letters and the code text. `title` holds the lines of the end card, and `{name}` gets replaced by the name. `part_names` are the body part names that appear in the code text.
3. A font is optional. Put one .ttf or .otf in `fonts/`, something you are allowed to redistribute like an SIL OFL font. Without one, the titles use a pixel font.
4. Run:
```bash
python make.py prep
python make.py spot
python make.py render
python make.py finish
```
- After `prep`, open **`build/check.png`**. One sheet shows the extracted colors, the layer split, where it found the eyes, the dark piece used in the still scene and the end card layout.
- After `spot`, look at `spot/<part>_sheet.jpg` before you render the whole thing.
- `finish` checks determinism (forward hashes equal backward hashes), the frame count (2400), flashing (3 or fewer per second) and loudness (-14 LUFS, true peak at or below -1 dBTP). Then it writes `out/color_longform.mp4`.
- Optional: `python make.py short` turns the drop through the end (34.7 seconds) into a vertical 1080×1920 video, a 4:5 picture with bars above and below. The 4:5 window jumps toward whatever is moving, on the beat. Output: `out/color_longform_short.mp4`.

## Prompts for an AI coding tool
First run, to check the setup with the sample:
```text
This repository is a template for making an 80-second video with my own character. Read AGENTS.md first and do only step 2 (the sample character run).
If something breaks, tell me what broke and why before you fix it. When you finish, show me build/check.png and the spot sheets.
```
With your character:
```text
Follow section 4 of AGENTS.md (making it with a person's character), in order.
- My character images: (folder path), transparent PNGs, (how many pose folders, or a single image)
- Name: (name). End card title: (for example NAME / IN COLOR)
- Font: (file path, or none for the pixel font)
- Music: keep the included track
When something needs a decision (which pose goes where, or colors that came out wrong), ask me. Don't fill in a default.
Show me build/check.png after prep and the sheets after spot. Render everything only after I say they look fine.
At the end, show me gates/report.json as it is. I will judge how the video looks myself.
```

## Changing things
| To change | Where |
|---|---|
| The extracted colors look wrong | `config.json`: `"palette": {"k1": "#E83437"}`. Names you can use: `ink`, `paper`, `deep`, `k1`, `k2`, `k3`. Only the fill color changes. The layer split stays as it was. |
| The order the colors come back in | `"key_order": [2, 0, 1]` puts the current k3 first, and so on |
| Eye or clap position is off | `"anchors": {"eye_zoom": [900, 520], "hands": [1500, 600]}`. What each value means is in [`AGENTS.md`](AGENTS.md) |
| The 8 "someone else's" colors and their names | `"other_colors": ["#38836D", …]` and `"other_names": ["MINT", …]` |
| End card colors | `"end": {"sun": "#FD9702", "wave": "#E02B2C", "cream": "#FDDCA6"}` |
| Scene order, framing, beats | `scenes/*.html`. The value tables are explained in the comments at the top of each file. Icons and the moving devices are in `scenes/devices.js` |
| Music | `music/build_music.py`. If you change the beat map, the scenes have to change with it ([`docs/방법.md`](docs/방법.md)) |

How it was made is in [`docs/방법.md`](docs/방법.md): the beat map, how screen events lock to the music, determinism and the hash checks, loudness, the countermelody rules. What changed along the way is in [`docs/제작기.md`](docs/제작기.md). Both are in Korean.

## What has been checked and what hasn't
- Checked. A fresh copy of this repository in an empty folder (new Python 3.10 venv, `npm install`) goes from the sample character to a finished mp4 with every check passing. The one-image path with a font file draws every frame of all four parts. With the original character's layers plugged in, the scene code reproduces the original video: all 2,400 frame hashes match, and the rebuilt music WAV is identical down to the byte.
- Not checked: **whether another computer (another OS, another Chromium build) gives the same pixels.** On one machine, redrawing always matched. The flash check only looks at average screen brightness, so small flashing areas and red flashes are not measured.
- None of the checks can tell you whether the result looks like your character, or whether picture and music fit together. Watch it to the end with the sound on.

## License
Everything in this repository is CC0 1.0 except one file. Use it however you like. The rights to the character drawings and fonts you add stay with you.
The exception is `web/duru.png`, the Duru example on the web page. Duru is the character of the channel 아낌없이 주는 두루. You can use that image to try the web page and for nothing else: no redistribution and no commercial use, and the same goes for videos made with it. The Duru drawing was made with GPT. Details are in [`NOTICE`](NOTICE).
GSAP is not stored here. `npm install` fetches it, and it comes with its own license. The VSCO 2 Community Edition samples are CC0.
The screen code and the music were made with Claude (Anthropic).
