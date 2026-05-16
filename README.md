# Neural Network and Gradient Descent Playground

An interactive browser-based machine learning lab with two connected workspaces:

- **Neural Network Playground 2D Classifier**: generate or draw 2D datasets and watch a small neural network learn a classification boundary.
- **Gradient Descent Visualizer**: compare optimizers on 3D loss surfaces and inspect how they move toward minima.

The project is intentionally lightweight: it runs as a static web app, uses vanilla JavaScript, and renders the optimizer surface with Three.js.

## Highlights

- Generate classic 2D classification datasets: circles, moons, spirals, XOR, and Gaussian clusters.
- Draw custom class-labeled points directly on the classifier canvas.
- Train a configurable neural network with hidden units, depth, activation, optimizer, learning rate, L2 regularization, and a hard epoch limit.
- Track training and validation behavior with an 80/20 validation split.
- View validation loss, validation accuracy, compact learning charts, an overfitting warning, and a confusion matrix.
- Visualize optimizer paths on 3D loss surfaces: `x^2 + y^2`, Rosenbrock, and Himmelblau.
- Enter custom 2D loss functions using `x`, `y`, arithmetic operators, constants, and common math functions.
- Compare gradient descent, momentum, Adam, and RMSprop with learning-rate schedules.
- Inspect explicit optimizer statuses: `Converged`, `Max steps reached`, `Boundary clipped`, `Diverging`, `Paused`, and `Running`.
- Replay stored optimizer paths and scrub both optimizer and neural-network timelines.
- Export and import experiment JSON files.
- Show a WebGL fallback message if 3D rendering is unavailable.

## Screens

### Part 1: Neural Network Playground

Use this panel to see how model capacity, learning rate, regularization, noise, and dataset geometry affect classification. The model learns directly in the browser.

The classifier view includes:

- generated or hand-drawn points
- live decision boundary
- train and validation metrics
- loss and accuracy charts
- confusion matrix
- overfitting signal
- epoch-limited training

### Part 2: Gradient Descent Visualizer

Use this panel to study optimization behavior on a 3D loss surface. It is useful for seeing why different optimizers can follow different paths and why a run can fail even when it appears to move downhill.

The optimizer view includes:

- 3D surface rendering
- optimizer path trails
- minimum markers
- start-point controls
- custom function input
- custom function examples
- animation speed control
- replay and timeline scrubber
- result cards with loss, status, position, distance, clipping, and termination reason

## Run Locally

Install dependencies:

```powershell
npm install
```

Start a local static server from the project folder:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:5500/
```

## Test

Run the focused test suite:

```powershell
npm test
```

The tests cover:

- expression parsing
- finite-difference gradient sanity
- estimated minimum behavior on standard surfaces
- optimizer status classification
- epoch-limit behavior
- confusion matrix calculation
- experiment JSON round-trip shape

## Custom Function Syntax

Custom surfaces support:

- variables: `x`, `y`
- constants: `pi`, `e`
- operators: `+`, `-`, `*`, `/`, `^`
- parentheses
- functions such as `sin`, `cos`, `tan`, `sqrt`, `log`, `exp`, `abs`, `min`, `max`, `pow`

Examples:

```text
x^2 + y^2
sin(x * y) + 0.08 * (x^2 + y^2) + cos(1.7*x)
0.06 * (x^2 + y^2) + sin(3*x) * cos(2*y)
(1.5 - x + x*y)^2 + (2.25 - x + x*y^2)^2 + (2.625 - x + x*y^3)^2
```

## Accuracy Notes

Built-in surfaces use known gradients and known minimum locations.

Custom functions are approximate:

- gradients are computed with finite differences
- the shown minimum is estimated from grid sampling plus local refinement
- nonconvex functions can have multiple local minima
- a selected domain can exclude the true global minimum
- narrow valleys or discontinuities can mislead numerical search
- boundary clipping means the optimizer is trying to move outside the chosen domain

Because of this, custom-function labels intentionally say **estimated minimum** instead of exact minimum.

## Project Structure

```text
neural-optimizer-playground/
  index.html              App markup and import map
  styles.css              Full UI styling and responsive layout
  app.js                  Classifier, optimizer, rendering, parser, import/export logic
  package.json            Project metadata and test script
  package-lock.json       Locked dependency versions
  tests/
    core.test.mjs         Focused math and behavior tests
  README.md               Project documentation
```

## GitHub Publishing Checklist

Commit these files and folders:

```text
index.html
styles.css
app.js
README.md
package.json
package-lock.json
tests/
.gitignore
```

Do **not** commit these:

```text
node_modules/
*.log
*.json exported experiment files unless they are intentional examples
.DS_Store
Thumbs.db
```

Important GitHub Pages note: the current app imports Three.js from `node_modules` through the import map. That is correct for local development after `npm install`, but plain GitHub Pages does not run `npm install`. For a live GitHub Pages deployment, use one of these approaches:

- switch the import map to a CDN-hosted Three.js URL
- add a build step with Vite or another bundler
- commit a vendored Three.js file intentionally

For a normal GitHub repository, the recommended choice is to commit `package.json` and `package-lock.json`, exclude `node_modules`, and tell users to run `npm install`.

## Suggested Repository Description

```text
Interactive browser ML lab for visualizing 2D neural-network classification and 3D gradient-descent optimizer behavior.
```

## Suggested Topics

```text
machine-learning
neural-network
gradient-descent
optimization
threejs
javascript
visualization
education
```

## Roadmap

- Add more optimizers such as Nesterov momentum and AdaGrad.
- Add train/test split controls.
- Add preset neural-network exercises.
- Add downloadable PNG screenshots of runs.
- Add GitHub Pages deployment support through CDN imports or a build pipeline.
- Add a more formal test harness for browser UI smoke tests.
