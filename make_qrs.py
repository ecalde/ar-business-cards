from pathlib import Path
import qrcode

BASE_URL = "https://ecalde.github.io/ar-business-cards/"
OUT_DIR = Path("qrs")
OUT_DIR.mkdir(exist_ok=True)

for i in range(1, 61):
    card_id = f"card_{i:03d}"
    url = f"{BASE_URL}?id={card_id}"

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=16,
        border=2
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    img.save(OUT_DIR / f"qr_{card_id}.png")

print("Done:", OUT_DIR.resolve())
