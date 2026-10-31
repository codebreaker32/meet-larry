import "server-only";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { FIREBASE_PROJECT_ID } from "./config";

// firebase-admin for the server: ID token checks (D18) and Firestore. No key file anywhere.
// Credentials come from Application Default Credentials: the VM's service account (metadata
// server) in production, `gcloud auth application-default login` on a laptop. Verifying an ID
// token needs no credentials at all (only the project id and Google's public keys), so sign-in
// works on a laptop without ADC; Firestore does not, and falls back to memory there (db/index.ts).

const APP_NAME = "larry-server";

/** The one admin app for this process. */
export function adminApp(): App {
  return getApps().find((a) => a.name === APP_NAME) ?? initializeApp({ projectId: FIREBASE_PROJECT_ID }, APP_NAME);
}

export const adminAuth = (): Auth => getAuth(adminApp());

let db: Firestore | undefined;
export function adminFirestore(): Firestore {
  if (!db) {
    db = getFirestore(adminApp());
    // Optional fields stay out of documents instead of failing the write.
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

/**
 * True when Application Default Credentials can be found: a key file named by
 * GOOGLE_APPLICATION_CREDENTIALS, the gcloud ADC file, or production (the VM's metadata server).
 * Never reads or prints the credentials themselves.
 */
export function hasApplicationDefaultCredentials(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const named = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (named) return existsSync(/*turbopackIgnore: true*/ named);
  const config = process.env.CLOUDSDK_CONFIG || path.join(homedir(), ".config", "gcloud");
  return existsSync(/*turbopackIgnore: true*/ path.join(config, "application_default_credentials.json"));
}
