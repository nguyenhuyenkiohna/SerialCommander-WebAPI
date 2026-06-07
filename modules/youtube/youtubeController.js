const { sendError, sendSuccess } = require("../../kernels/middlewares/errorHandler");
const youtubeSearchService = require("./youtubeSearchService");

exports.searchVideos = async (req, res) => {
  const q = String(req.query.q ?? "").trim();

  if (q.length > 120) {
    return sendError(res, 400, "Từ khóa tìm kiếm quá dài (tối đa 120 ký tự).", "YOUTUBE_QUERY_TOO_LONG");
  }

  try {
    const maxResults = Math.min(Math.max(parseInt(String(req.query.maxResults || "12"), 10) || 12, 1), 20);
    const result = await youtubeSearchService.searchYoutube(q, maxResults);

    if (result.apiEnabled && q && result.items.length === 0) {
      return sendSuccess(res, 200, "Không có video liên quan Serial/UART/nhúng cho từ khóa này.", {
        ...result,
        emptyReason: "no_project_match",
      });
    }

    return sendSuccess(
      res,
      200,
      result.apiEnabled ? "Tìm YouTube thành công." : "YouTube API chưa bật trên server.",
      result
    );
  } catch (err) {
    const status = Number(err.statusCode) || 502;
    return sendError(
      res,
      status,
      err.message || "Không gọi được YouTube Data API.",
      "YOUTUBE_SEARCH_FAILED"
    );
  }
};
