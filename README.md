# Bar Misaki 抽選システム

お客様用 `/lottery` と従業員用 `/admin` を備えた、React + TypeScript + Tailwind CSS + Firebase の抽選Webアプリです。

## 主な機能

- カウンター（2名必須）／個室（1〜2名）の応募
- X IDの正規化、形式検証、ラウンド全体での重複防止
- 安全な端末トークンによる応募・結果の復元
- カウンター／個室それぞれの組単位抽選
- 暗号学的乱数による抽選と一意の当選者コード
- 当選者の除外、公開前の取消、空き枠のみの再抽選
- 公開操作までお客様へ当落を伏せる結果管理
- 2段階確認付きリセットと、削除されない操作履歴
- Firebase Custom Tokenによる管理者認証
- Firebase未設定でも確認できるローカルデモモード

## ローカル起動

```bash
pnpm install
pnpm dev
```

- お客様画面: `http://localhost:5173/lottery`
- 従業員画面: `http://localhost:5173/admin`
- デモ用初期パスワード: `3331`

デモパスワードは `.env.local` の `VITE_DEMO_ADMIN_PASSWORD` で変更できます。デモモードはブラウザ内の動作確認専用で、本番運用には使用しないでください。

## Firebase設定

1. Firebaseプロジェクトで Authentication、Firestore、Functions、Hosting を有効化します。
2. `.env.example` を `.env.local` にコピーし、WebアプリのFirebase設定を入力します。
3. 管理者共有パスワードをSecret Managerへ登録します。

```bash
firebase functions:secrets:set ADMIN_SHARED_PASSWORD
```

4. Functionsの依存関係をインストールします。

```bash
pnpm --dir functions install
```

管理者パスワードはソースコードや `.env` に保存せず、必ず `ADMIN_SHARED_PASSWORD` Secretとして設定してください。ログイン成功時にCloud Functionsが `admin: true` のCustom Tokenを発行します。

## データ構造とセキュリティ

- `lotteryRuntime/current`: 現在のラウンドと公開状態
- `lotteryEntries`: 応募グループ
- `lotteryIdentifiers`: 正規化X IDの占有マーカー
- `lotteryTokens`: ハッシュ化した端末トークンと応募の対応
- `lotteryAuditLogs`: 操作履歴

応募登録はFirestoreトランザクションで、端末トークンと全X IDのマーカーを同時に確認・作成します。カウンターと個室、代表者と同伴者をまたいだ同時応募でも二重登録されません。ブラウザからFirestoreへの直接アクセスはルールですべて拒否し、検証済みCloud Functionsだけがデータを操作します。

リセット時は過去データを物理削除せず、新しいラウンドIDへ切り替えます。これにより古い結果・当選者コード・端末トークンを即時無効化しつつ、監査履歴を保持します。

## ビルドと公開

```bash
pnpm build
pnpm --dir functions build
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

## 画像の差し替え

右上のBar Misakiロゴは `public/bar-misaki-mark.png` です。お客様画面のメンバーコイン画像は `public/coin-faces/` にあり、応募フォーム下のコインギャラリーで使用しています。
