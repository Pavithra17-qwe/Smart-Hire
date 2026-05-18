import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

// ── Read private key from environment and fix line breaks ──
const privateKey = `-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCUteixNX7cD/fM\nl8Mjm8n4Vv0J3Xhzf2LJh2UBL7e59j+l4j8fqKOxjfPsSro/SF2Xb8A9ykQV0DA7\nNfiwVnphM/CJ+mXgFvmpYsAaCiPGd6p/bjBLnnXWFSa9qmLjk2LOHKLK9PRpLslU\nhLfG4o0pTcFO21bDlyqJcDU5c0EVQanrXdQhY+7dNcuhRJuo4lzJmmc+V2sM9Q0q\nTsK6jdozM5W0c6IdLyUX9bpKBEXcNuqE7mAc8UVPJ6316RfD2lw87jssgANDEOHD\nHXnareJo91ykAaVXXh/3MU6O6stWmUmsYeljXCkxlLTpfD8mlEu514t8D7/AKeQH\nEUdHtD1rAgMBAAECggEAOn7PmB012HRDgevUa4ZVTOVSxXWjcrMR9bnXZj8R4wlV\nAfhb4iUgtq/i2fiPCGN7xRzFHskYPQhWYIQbXam2m9Olc3DWb+45qIJalCOW7POX\nUmbSgnxDV8GcKpECMwh/nhmvg2wVU+Z+dUt7SrVE15FpT46Bs5AbwFIt7XpDiIth\nO7451tigiKps9h8OpW5CeUcQbJScgcdzltREtHfkFaGm916rnGwTAYUi/oLzDEDK\noz3RyvZCsu9vSTY752I1g+n2ghuygbX4AIlQLqErR76Ez9cIgVHpqi+4BVjctnw8\n/x3ZWzX2ZyGi24pCf8RpVRy9Bara+f5aNTLe2vgB0QKBgQDFb7hHq+BQlhTXTKW7\ne4kGuV1Dvde00e9r9d1wsvIcDIeya9nhoCAM3y7nutNhJJu1avdf0pAuhU3LgGpH\ncZhrq7Www6uVYfWiMaS1dpL04BEvMJKrlPKAHdoRserbbiFJpA4AUYXZV71dANc8\nE68dbzxSHGpaS3rqdlnPMsyzAwKBgQDA0jTzPVonhnddLAjB9qmL2hobSvuTK/pD\n9skDDffLKjML+pRrXOCLumsysNECHp4btWnRZo0+YTOVzvbuxbB3x9WO/J1J4wxQ\nyvJcGc+ntDLJTDB/v8E+8hBmpoMMvjRq+KOWrNmfZNGsU6UuMSobneSt3XKa4jv1\nAvoaROuLeQKBgCpERoEhbH4UAxYsVHaUdbs4x5yO8bTGFKlaEzPjOy2CCTLLH/PL\nYdEfnl0Bg+sR+TuXUKn02+T5qLPeI+JzkRvLwLO8z+jE9d7pHcezQLanmUYu8ddF\npbyDp4GOQycCpqGrO0waJ7tlqyZT3cAAvsZgX9t8NdBqxD+ZYpSW3XedAoGAaYDb\nDhiMwsG1gBp+9DpVzLravAJMItvWROe8VtqGsfh2E+DY4uHfzzSCQSs0QXelRT3/\nF1+IexBOXHLw8/bhNrj15hXcrjf4XiCdeb15vKZBf5kblFrEjv9979y+KfPM1JcV\nU3ViYe+VNjhSUjL+ejvriyJ2+b491jL5y/PX+ekCgYB549rCN00nYO9r/zgF7t+Q\nXro2L7vU7Ig+T4Qn9s4Iby1ffFXfbfxNEOqvOOAtYakCnxGiDuCZOsD6m/paBTrs\nAdy268H/e29BBVCs6eogefafVmJ0foT9dJL7T9WmU/amrYBg9zn2GTO7GcS10X4a\n3pPiTOFbj/NXnDoveMboyQ==\n-----END PRIVATE KEY-----\n`;

const serviceAccount = {
  type: "service_account",
  project_id: "recruitement-5778d",
  private_key_id: "6d5e9d6ed1c6a3f221c4c10045c0614b7bbd2e98",
  private_key: privateKey,
  client_email: "firebase-adminsdk-fbsvc@recruitement-5778d.iam.gserviceaccount.com",
  client_id: "115181252254594488205",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40recruitement-5778d.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
};

const adminApp =
  getApps().find(app => app.name === 'admin') ||
  initializeApp(
    {
      credential: cert(serviceAccount as any),
      storageBucket: 'recruitement-5778d.appspot.com',
    },
    'admin'
  );

export const adminDb      = getFirestore(adminApp);
export const adminAuth    = getAuth(adminApp);
export const adminStorage = getStorage(adminApp);