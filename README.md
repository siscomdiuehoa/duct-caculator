# SISCOM Duct

Phần mềm thiết kế phụ kiện ống gió chữ nhật của SISCOM (web, Android, iOS).

Bản đầu chạy trên web: bốn loại phụ kiện (ống thẳng, co 90°, côn thu, tê), mô hình 3D, ba hình chiếu, diện tích và khối lượng tôn, xuất DXF, CSV, JSON.

## Chạy thử

```bash
npm install
npm run dev      # mở địa chỉ được in ra
npm test         # kiểm thử lõi hình học
npm run build    # bản phát hành trong thư mục dist/
```

## Tài liệu

- Thiết kế: [docs/superpowers/specs/2026-11-23-duct-calculator-design.md](docs/superpowers/specs/2026-11-23-duct-calculator-design.md)
- Kế hoạch bản đầu: [docs/superpowers/plans/2026-11-23-web-mvp.md](docs/superpowers/plans/2026-11-23-web-mvp.md)

## Thêm một loại phụ kiện

Khai báo một `FittingDef` mới trong `src/core/fittings.ts` (thông số, kiểm tra hợp lệ, hàm dựng các tấm tôn và đường kích thước), thêm tên vào `src/i18n.ts`, và thêm phép tính tay vào `src/core/core.test.ts`. Mô hình 3D, hình chiếu, DXF và khối lượng tự sinh ra từ đó.
