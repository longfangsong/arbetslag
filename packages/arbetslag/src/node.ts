// Node.js-only exports.
//
// Everything here relies on Node.js APIs (currently the file-system backed
// JSON storage). It must not be imported from the package root in Workers or
// other non-Node environments: doing so would pull `node:fs` into their
// bundles. Import from the "./node" subpath only in Node.
export { NodeFileSystemStorage } from "./implementation/jsonStorage/nodeFileSystem";
