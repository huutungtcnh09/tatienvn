// Script tạo bài viết mẫu
const API = "http://localhost:4000/api";

async function run() {
  // Đăng nhập
  const loginRes = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@domain.com", password: "123456" }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error("Login failed: " + JSON.stringify(loginData));
  const token = loginData.data.accessToken;
  console.log("Login OK");

  const articles = [
    {
      title: "Bí quyết chăm sóc da với mỹ phẩm thiên nhiên",
      slug: "bi-quyet-cham-soc-da-my-pham-thien-nhien",
      category: "knowledge",
      status: "PUBLISHED",
      seoDesc: "Khám phá những bí quyết chăm sóc da hiệu quả từ các thành phần thiên nhiên thuần chay, an toàn cho mọi loại da.",
      content: `Chăm sóc da không cần phải phức tạp hay tốn kém. Với những thành phần thiên nhiên đơn giản, bạn hoàn toàn có thể có làn da khỏe mạnh và rạng rỡ mỗi ngày.

Nha đam là một trong những thành phần tự nhiên tuyệt vời nhất cho da. Gel nha đam chứa hơn 75 hoạt chất, bao gồm vitamin, khoáng chất và axit amin giúp dưỡng ẩm, làm dịu và tái tạo da hiệu quả. Chỉ cần lấy gel tươi trực tiếp từ lá nha đam và thoa lên mặt mỗi tối, bạn sẽ thấy da mềm mịn và sáng hơn chỉ sau 2 tuần.

Dầu argan được chiết xuất từ hạt của cây argan ở Maroc, nổi tiếng là "vàng lỏng" của ngành mỹ phẩm. Với hàm lượng vitamin E và axit béo không bão hòa cao, dầu argan giúp dưỡng ẩm sâu, chống lão hóa và làm sáng da tự nhiên. Chỉ cần vài giọt dầu argan nguyên chất thoa lên mặt trước khi ngủ là đủ.

Mật ong nguyên chất không chỉ là thực phẩm bổ dưỡng mà còn là thành phần chăm sóc da tuyệt vời. Đặc tính kháng khuẩn tự nhiên của mật ong giúp ngăn ngừa mụn, trong khi các enzyme và axit trong mật ong nhẹ nhàng tẩy tế bào chết, làm sáng đều màu da. Đắp mặt nạ mật ong 15 phút mỗi tuần 2-3 lần sẽ mang lại làn da căng bóng, mịn màng.

Bột nghệ từ lâu đã được sử dụng trong y học cổ truyền và làm đẹp tại nhiều nền văn hóa châu Á. Curcumin trong nghệ có đặc tính chống viêm và chống oxy hóa mạnh mẽ, giúp làm đều màu da, mờ thâm nám và mang lại làn da tươi sáng rạng rỡ. Kết hợp bột nghệ với sữa tươi và mật ong để tạo mặt nạ dưỡng da tự nhiên cực hiệu quả.

Hãy bắt đầu hành trình chăm sóc da thiên nhiên của bạn ngay hôm nay với những sản phẩm từ thương hiệu KD Beauty — được chiết xuất 100% từ thiên nhiên, không hóa chất độc hại, an toàn cho cả da nhạy cảm.`,
    },
    {
      title: "Top 5 sản phẩm bán chạy nhất tháng 5/2026",
      slug: "top-5-san-pham-ban-chay-nhat-thang-5-2026",
      category: "news",
      status: "PUBLISHED",
      seoDesc: "Danh sách 5 sản phẩm được yêu thích và bán chạy nhất trong tháng 5/2026 tại KD Beauty.",
      content: `Tháng 5 là tháng của những ưu đãi hấp dẫn và các sản phẩm chăm sóc da chống nắng được săn đón nhiều nhất. Dưới đây là top 5 sản phẩm bán chạy nhất tại KD Beauty trong tháng này.

Kem chống nắng KD Sun SPF50+ PA++++ là sản phẩm dẫn đầu bảng xếp hạng với công thức không nhờn rít, thấm nhanh và bảo vệ da toàn diện khỏi tia UVA/UVB. Đặc biệt phù hợp với khí hậu nóng ẩm Việt Nam.

Serum Vitamin C 20% KD Glow đứng thứ hai với công thức ổn định, giúp làm sáng da, mờ thâm và tăng cường độ đàn hồi. Sản phẩm được đóng gói trong lọ tối màu để bảo vệ vitamin C khỏi ánh sáng.

Kem dưỡng ẩm Aloe Vera Gel KD Hydra chiếm vị trí thứ ba nhờ kết cấu nhẹ nhàng, thấm nhanh và phù hợp với mọi loại da, kể cả da dầu và da nhạy cảm.

Toner cân bằng pH KD Balance đứng thứ tư với thành phần chính là nước hoa hồng hữu cơ và panthenol, giúp làm dịu, dưỡng ẩm và chuẩn bị da cho các bước dưỡng da tiếp theo.

Mặt nạ đất sét KD Clay Mask hoàn tất top 5 với khả năng làm sạch sâu, thu nhỏ lỗ chân lông và kiểm soát dầu thừa hiệu quả, đặc biệt phù hợp cho da dầu và da hỗn hợp.`,
    },
    {
      title: "Hướng dẫn xây dựng quy trình dưỡng da 5 bước cơ bản",
      slug: "huong-dan-xay-dung-quy-trinh-duong-da-5-buoc",
      category: "guide",
      status: "PUBLISHED",
      seoDesc: "Hướng dẫn chi tiết 5 bước skincare cơ bản giúp bạn xây dựng thói quen chăm sóc da đúng cách và hiệu quả.",
      content: `Một quy trình dưỡng da khoa học và đơn giản sẽ giúp làn da của bạn luôn khỏe mạnh, ít mụn và trẻ trung hơn. Dưới đây là 5 bước cơ bản mà bất kỳ ai cũng có thể áp dụng.

Bước 1 — Làm sạch: Đây là bước quan trọng nhất. Sử dụng sữa rửa mặt dịu nhẹ, phù hợp với loại da của bạn. Rửa mặt với nước ấm và mát xa nhẹ nhàng trong 60 giây để làm sạch bụi bẩn, dầu thừa và tạp chất. Buổi tối nên tẩy trang trước khi rửa mặt nếu có trang điểm.

Bước 2 — Toner: Sau khi rửa mặt, dùng toner để cân bằng độ pH cho da và chuẩn bị da hấp thụ các dưỡng chất tiếp theo. Thoa toner bằng tay hoặc bông tẩy trang, vỗ nhẹ lên da cho thấm đều.

Bước 3 — Serum: Đây là bước cung cấp dưỡng chất đặc trị. Tuỳ theo vấn đề da của bạn mà chọn serum phù hợp: vitamin C cho da xỉn màu, hyaluronic acid cho da khô, niacinamide cho da dầu mụn.

Bước 4 — Kem dưỡng ẩm: Dù da bạn là loại gì, dưỡng ẩm luôn là bước không thể bỏ qua. Kem dưỡng giúp khóa ẩm, bảo vệ da khỏi tác nhân môi trường và tạo hàng rào bảo vệ tự nhiên.

Bước 5 — Kem chống nắng (buổi sáng): Đây là bước quan trọng nhất trong quy trình buổi sáng. Kem chống nắng bảo vệ da khỏi tia UV — nguyên nhân hàng đầu gây lão hóa, thâm nám và ung thư da. Bôi đủ lượng và thoa lại sau mỗi 2 tiếng khi ra ngoài.

Kiên trì thực hiện đủ 5 bước này mỗi sáng và tối, bạn sẽ thấy sự khác biệt rõ rệt chỉ sau 4-6 tuần.`,
    },
  ];

  for (const article of articles) {
    try {
      const res = await fetch(`${API}/articles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(article),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error(`FAILED "${article.title}":`, data.message);
      } else {
        console.log(`Created: [${data.data.id}] "${data.data.title}"`);
      }
    } catch (e) {
      console.error(`ERROR "${article.title}":`, e.message);
    }
  }
}

run().catch(console.error);
