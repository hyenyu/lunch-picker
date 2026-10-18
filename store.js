// 페이지가 쓰던 저장소 방식(db.doc / db.collection)을 Firebase Firestore로 연결하는 파일
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const ready = firebaseConfig.projectId && !firebaseConfig.projectId.includes("붙여넣기");
let fs = null;
if (ready) fs = getFirestore(initializeApp(firebaseConfig));

const wrapDoc = s => ({ exists: s.exists(), id: s.id, data: () => s.data() });
const errCode = e => ({ code: e && e.code === "permission-denied" ? "invalid_argument" : (e && e.code) || "error" });

function docApi(path) {
  const ref = doc(fs, path);
  return {
    get: async () => wrapDoc(await getDoc(ref)),
    set: d => setDoc(ref, d).catch(e => { throw errCode(e) }),
    update: d => updateDoc(ref, d).catch(e => { throw errCode(e) }),
    delete: () => deleteDoc(ref),
    onSnapshot: (cb, err) => onSnapshot(ref, s => cb(wrapDoc(s)), err),
    // 동시에 누를 때 한 명씩 처리하기 위한 짧은 잠금
    acquire: async ({ holder, ttlMs }) => {
      const lock = doc(fs, "locks/" + path.replace(/\//g, "_"));
      try {
        return await runTransaction(fs, async t => {
          const s = await t.get(lock), now = Date.now();
          if (s.exists() && s.data().holder !== holder && s.data().exp > now) return { acquired: false };
          t.set(lock, { holder, exp: now + ttlMs });
          return { acquired: true };
        });
      } catch (e) { return { acquired: true } }
    }
  };
}

const db = fs && {
  doc: docApi,
  collection: name => ({
    onSnapshot: (cb, err) => onSnapshot(collection(fs, name), cb, err)
  })
};

// 처음 한 번만: 기존 식당 목록(places.json)을 데이터베이스에 넣기
async function seed() {
  const mark = doc(fs, "meta/seed");
  if ((await getDoc(mark)).exists()) return;
  const data = await (await fetch("places.json")).json();
  const ids = Object.keys(data);
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(fs);
    ids.slice(i, i + 400).forEach(id => b.set(doc(fs, "places/" + id), data[id]));
    await b.commit();
  }
  await setDoc(mark, { at: Date.now(), count: ids.length });
}

window.claude = {
  use: async name => {
    if (name !== "db" || !db) return null;
    try { await seed() } catch (e) { console.warn("seed", e) }
    return db;
  }
};
if (!ready) console.warn("firebase-config.js에 Firebase 설정을 넣어 주세요");
