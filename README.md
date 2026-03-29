# KBase Workspace Provenance Browser

A demo web app for exploring the provenance graph of objects in the [KBase Workspace Service](https://kbase.us/services/ws). Hosted at **https://mrcreosote.github.io/ws-prov-ui/**.

## What it does

- Enter your KBase token to authenticate
- Browse and search your accessible workspaces
- Pick an object within a workspace
- View an interactive DAG showing:
  - **Backward provenance** — other objects that reference the selected object (`list_referencing_objects`)
  - **Forward provenance** — objects the selected object was derived from (`get_objects2` via provenance chains, including objects in otherwise-inaccessible workspaces)

## Usage

1. Open the app and paste a KBase token into the token field (top right). The token is saved to `localStorage`.
2. Select a workspace from the searchable dropdown. Workspaces are displayed with their narrative name, workspace name, and ID.
3. Select an object. The picker prefills with up to 1000 objects from the workspace; typing searches by name prefix. Each option shows the object name, type, version, date, creator, and size.
4. The provenance graph loads with the selected object as the root node.

## Development

```bash
npm install
npm run dev      # dev server at http://localhost:5173/ws-prov-ui/
npm run build    # production build → dist/
npm run lint
```

Deployment to GitHub Pages happens automatically on push to `main` via `.github/workflows/deploy.yml`.
