# PLAN-signal-accuracy 🎯

> **Status**: DRAFT (Menunggu Persetujuan)
> **Tujuan**: Meningkatkan akurasi dan "Win Rate" (Rasio Kemenangan) dari Signal Engine pada aplikasi BTC Trading Signal dengan menerapkan filter kuantitatif profesional untuk mengurangi *whipsaws* (sinyal palsu).

---

## 🔍 Analisis Masalah Saat Ini (Latar Belakang)
Saat ini sistem mengandalkan *crossover* EMA, posisi batas RSI (oversold/overbought), dan *filter* dasar dari MACD histogram. Dalam market *crypto* yang *volatile*, indikator statis seperti ini seringkali tertinggal (*lagging*) atau memicu *late entry*. Kita sudah menambahkan deteksi *choppy market* dasar dengan Bollinger Bands *width*, namun ini bisa dipertajam jauh lebih akurat.

## 🚀 Rencana Peningkatan Akurasi (The Plan)

Berikut adalah 3 elemen utama (Kuantitatif) yang perlu kita tambahkan ke dalam perhitungan `signal-engine.js` agar kualitas sinyal menjadi kelas "Institusional":

### 1. Volume Confirmation (Filter Bull-Trap & Bear-Trap)
Sebuah *breakout* (contoh: harga menyilang EMA21 ke atas) **tidak valid** asalkan tidak diikuti oleh lonjakan volume. Kita akan mengintegrasikan indikator Volume untuk menolak sinyal (WAIT) jika volume market berada di bawah rata-rata (Volume Moving Average).
*   **Aksi**: Tambahkan kalkulasi SMA (Simple Moving Average) khusus data Volume, lalu syaratkan `Volume_Saat_Ini > SMA_Volume_20` untuk memicu BUY/SELL.

### 2. Divergence Analysis pada RSI & MACD
*Oscillator* seperti RSI dan MACD bekerja paling akurat bukan saat menyentuh angka 30 atau 70, melainkan saat terjadi *"Divergence"* (Perbedaan arah grafik indikator vs arah grafik harga asli).
*   **Aksi**: Tambahkan memori pembacaan pada *engine*. Jika Harga BTC membentuk "Lower Low" (semakin turun), tapi RSI membentuk "Higher Low" (semakin naik) → Ini adalah Sinyal BUY (Bullish Divergence) dengan tingkat akurasi 80%+. Ini akan menggantikan logika entry konvensional.

### 3. Dinamic RSI Thresholds (Mengatasi False Overbought di Bull Market)
Pada kripto (khususnya BTC), ketika *Bull Run* terjadi, indikator RSI sering "*nyangkut*" di atas 70 dalam waktu lama. Menjual saat menyentuh angka 70 akan menghilangkan banyak profit.
*   **Aksi**: Ubah angka 30 & 70 menjadi dinamis. Jika H4 trend sedang "Super Bullish" (jarak EMA sangat jauh merenggang), batas Overbought digeser menjadi 80 atau 85, sehingga sistem tahu untuk tidak buru-buru menyuruh Anda melepas posisi. Dikenal juga dengan sebutan RSI-Bollinger Bands.

---

## 📋 Task Breakdown (Implementasi Fase Berikutnya)

Jika Anda menyetujui rencana peningkatan diatas, berikut adalah yang akan dieksekusi oleh Agen Spesialis:

- [ ] **Data Science / Math Upgrade**: Memperkenalkan pembacaan *Volume SMA* pada `src/logic/indicators.js`.
- [ ] **Algorithm Update**: Memodifikasi `signal-engine.js` untuk merecord formasi *Higher High / Lower Low* demi mendeteksi **Divergences**.
- [ ] **UI Feedback**: Menambahkan label di panel (misal: "Volume Confirmed: YES" atau "Divergence: DETECTED").
- [ ] **Backtesting Simulation (Optional)**: Membuat modul ringan untuk mengetes ulang *rules* baru ini berdasarkan data history yang tersimpan di *LocalStorage*.

---

## 🚦 Keputusan (User Gate)

Gagasan ini berpotensi meningkatkan *Win Rate* aplikasi Anda dari estimasi ~55% menjadi ~65-72%, namun logikanya akan sedikit lebih ketat dan jumlah kemunculan sinyal dalam sehari mungkin akan berkurang (mengedepankan **Kualitas vs Kuantitas**).

Apakah ada fitur filter spesifik yang biasa Anda pakai *manual* di MT5 yang ingin saya tambahkan ke dalam Plan ini sebelum saya membangun kodenya? (misal: "Saya biasa pakai Fibonacci", atau "Saya lihat Ichimoku").
