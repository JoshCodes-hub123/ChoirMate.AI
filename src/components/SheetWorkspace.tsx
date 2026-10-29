import React, { useState, useRef } from 'react';
import {
  Upload,
  Camera,
  Sparkles,
  Music,
  AlertCircle,
  Loader2,
  BookOpen,
  CheckCircle2,
  FileCode2,
  FileText,
  Layers,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { ScoreAnalysis } from '../types/music';
import { SAMPLE_SCORES } from '../data/sampleScores';
import { getApiUrl } from '../utils/apiConfig';

interface SheetWorkspaceProps {
  onScoreAnalyzed: (score: ScoreAnalysis) => void;
}

interface PdfPagePreview {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
  thumbnailDataUrl: string;
  rotatedDegrees?: number;
  deskewAngle?: number;
  status: 'ok' | 'failed';
  error?: string | null;
}

interface PdfDocumentPreview {
  fileName: string;
  fileSizeBytes: number;
  pdfBase64: string;
  pageCount: number;
  pages: PdfPagePreview[];
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB per image
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB per PDF

export const SheetWorkspace: React.FC<SheetWorkspaceProps> = ({ onScoreAnalyzed }) => {
  const [selectedTitle, setSelectedTitle] = useState('');
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [imageFileNames, setImageFileNames] = useState<string[]>([]);
  const [pdfPreview, setPdfPreview] = useState<PdfDocumentPreview | null>(null);
  const [isRenderingPdfPreview, setIsRenderingPdfPreview] = useState(false);
  const [uploadedXmlContent, setUploadedXmlContent] = useState<string | null>(null);
  const [uploadedXmlFileName, setUploadedXmlFileName] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAllSelections = () => {
    setPreviewImages([]);
    setImageFileNames([]);
    setPdfPreview(null);
    setUploadedXmlContent(null);
    setUploadedXmlFileName(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const fetchWithRetry = async (url: string, options: RequestInit, retries = 2, delayMs = 1500): Promise<Response> => {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
        return fetchWithRetry(url, options, retries - 1, delayMs * 1.5);
      }
      throw err;
    }
  };

  const formatApiError = (err: unknown, fallback: string): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Network request failed')) {
      return 'Could not connect to the backend server. Please check your network connection and try again.';
    }
    if (msg.includes('502') || msg.includes('503') || msg.includes('504')) {
      return 'The music analysis engine is initializing or temporarily busy. Please try again in 15 seconds.';
    }
    if (msg.includes('JSON') || msg.includes('Unexpected token')) {
      return 'The server returned an unreadable response. Please try again.';
    }
    return msg || fallback;
  };

  const handlePdfFile = async (pdfFile: File) => {
    if (pdfFile.size === 0) {
      setErrorMessage(`The file "${pdfFile.name}" is empty.`);
      return;
    }
    if (pdfFile.size > MAX_PDF_BYTES) {
      setErrorMessage(
        `PDF "${pdfFile.name}" (${(pdfFile.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 25 MB upload limit.`
      );
      return;
    }

    setIsRenderingPdfPreview(true);
    setErrorMessage(null);
    setPreviewImages([]);
    setImageFileNames([]);
    setUploadedXmlContent(null);
    setUploadedXmlFileName(null);

    if (!selectedTitle) {
      setSelectedTitle(pdfFile.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '));
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read the selected PDF file.'));
        reader.readAsDataURL(pdfFile);
      });

      const res = await fetchWithRetry(getApiUrl('/api/preview-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64: dataUrl,
          fileName: pdfFile.name,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Could not validate or preview the uploaded PDF file.');
      }

      setPdfPreview({
        fileName: pdfFile.name,
        fileSizeBytes: pdfFile.size,
        pdfBase64: dataUrl,
        pageCount: json.pageCount || (json.pages ? json.pages.length : 1),
        pages: json.pages || [],
      });
    } catch (err: unknown) {
      setPdfPreview(null);
      setErrorMessage(
        formatApiError(
          err,
          'Could not preview the selected PDF document. Please verify that it is a valid, unencrypted PDF.'
        )
      );
    } finally {
      setIsRenderingPdfPreview(false);
    }
  };

  const handleFilesSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMessage(null);

    const firstFile = files[0];
    const fileNameLower = firstFile.name.toLowerCase();

    // 1. Check for PDF document
    const isPdf =
      fileNameLower.endsWith('.pdf') || firstFile.type === 'application/pdf';
    if (isPdf) {
      handlePdfFile(firstFile);
      return;
    }

    // 2. Check for MusicXML document
    const isMusicXml =
      fileNameLower.endsWith('.musicxml') ||
      fileNameLower.endsWith('.xml') ||
      firstFile.type === 'application/vnd.recordare.musicxml+xml' ||
      firstFile.type === 'text/xml' ||
      firstFile.type === 'application/xml';

    if (isMusicXml) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedXmlContent(reader.result as string);
        setUploadedXmlFileName(firstFile.name);
        setPreviewImages([]);
        setImageFileNames([]);
        setPdfPreview(null);
        if (!selectedTitle) {
          setSelectedTitle(firstFile.name.replace(/\.(musicxml|xml)$/i, '').replace(/[-_]/g, ' '));
        }
      };
      reader.readAsText(firstFile);
      return;
    }

    // 3. Check for PNG/JPG/JPEG/WebP image files
    const imageFiles = Array.from(files).filter(
      (file) =>
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp)$/i.test(file.name)
    );

    if (imageFiles.length === 0) {
      setErrorMessage(
        'Unsupported file type. Please upload a PDF sheet music document (.pdf), page images (PNG, JPG, JPEG), or a MusicXML (.musicxml / .xml) file.'
      );
      return;
    }

    for (const imgFile of imageFiles) {
      if (imgFile.size > MAX_IMAGE_BYTES) {
        setErrorMessage(
          `Image "${imgFile.name}" (${(imgFile.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 15 MB per-page image limit.`
        );
        return;
      }
    }

    setUploadedXmlContent(null);
    setUploadedXmlFileName(null);
    setPdfPreview(null);

    if (!selectedTitle && imageFiles[0]) {
      setSelectedTitle(imageFiles[0].name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
    }

    Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<{ name: string; dataUrl: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: file.name, dataUrl: reader.result as string });
            reader.readAsDataURL(file);
          })
      )
    ).then((loadedItems) => {
      setPreviewImages((prev) => [...prev, ...loadedItems.map((i) => i.dataUrl)]);
      setImageFileNames((prev) => [...prev, ...loadedItems.map((i) => i.name)]);
    });
  };

  const handleRemovePage = (index: number) => {
    setPreviewImages((prev) => prev.filter((_, idx) => idx !== index));
    setImageFileNames((prev) => prev.filter((_, idx) => idx !== index));
  };

  const hasReadyDocument =
    Boolean(pdfPreview && pdfPreview.pages.length > 0) ||
    previewImages.length > 0 ||
    Boolean(uploadedXmlContent);

  const handleAnalyzeSheet = async () => {
    if (!hasReadyDocument || isRenderingPdfPreview) return;
    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      let payload: Record<string, unknown>;
      if (uploadedXmlContent) {
        payload = {
          musicxml: uploadedXmlContent,
          title: selectedTitle.trim() || undefined,
        };
      } else if (pdfPreview) {
        payload = {
          pdfBase64: pdfPreview.pdfBase64,
          pdfFileName: pdfPreview.fileName,
          title:
            selectedTitle.trim() ||
            pdfPreview.fileName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '),
        };
      } else {
        payload = {
          imageBase64: previewImages[0],
          pages: previewImages,
          mimeType: 'image/png',
          title: selectedTitle.trim() || undefined,
        };
      }

      const response = await fetchWithRetry(getApiUrl('/api/analyze-sheet'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await response.json();
      if (!response.ok || json.success === false) {
        throw new Error(json.error || 'Failed to analyze full sheet music score');
      }

      const rawScore: ScoreAnalysis = json.data ? json.data : json;
      const fallbackPages = pdfPreview
        ? pdfPreview.pages.filter((p) => p.dataUrl).map((p) => p.dataUrl)
        : previewImages;

      const finalScore: ScoreAnalysis = {
        ...rawScore,
        imageUrl: rawScore.imageUrl || fallbackPages[0],
        pageImages:
          rawScore.pageImages && rawScore.pageImages.length > 0
            ? rawScore.pageImages
            : fallbackPages,
      };
      onScoreAnalyzed(finalScore);
    } catch (err: unknown) {
      setErrorMessage(
        formatApiError(err, 'Unexpected error analyzing sheet music score')
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left Column: Full-Page PDF, Multi-Page Image & MusicXML Scanner */}
      <div className="lg:col-span-7 bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#B85D19] bg-[#FDF3EB] px-2.5 py-1 rounded-md border border-[#F5DEC9]">
              <Sparkles className="w-3.5 h-3.5" />
              Multi-Page PDF &amp; Image OMR + Solfa Tutor
            </span>
            <h2 className="text-2xl font-serif font-bold text-[#2A2622] mt-2">
              Upload a Complete Sheet Music Score
            </h2>
          </div>
        </div>

        <p className="text-sm text-[#6A6258] mb-6 leading-relaxed">
          Upload a complete single-page or multi-page <strong>PDF document</strong>, or <strong>PNG / JPG</strong> images of printed choral or vocal sheet music—including multi-system hymns, SATB choir arrangements, treble and bass staves, key signatures, rests, and dotted rhythms.
        </p>

        {/* Optional Score Title Input */}
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#6A6258] mb-1.5">
            Piece Title (Optional)
          </label>
          <input
            type="text"
            value={selectedTitle}
            onChange={(e) => setSelectedTitle(e.target.value)}
            placeholder="e.g., Amazing Grace (SATB Multi-Page PDF)"
            className="w-full px-3.5 py-2.5 bg-white border border-[#DED8CC] rounded-xl text-sm text-[#2A2622] focus:outline-none focus:border-[#B85D19]"
          />
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilesSelect(e.dataTransfer.files);
          }}
          onClick={() => {
            if (!hasReadyDocument && !isRenderingPdfPreview) {
              fileInputRef.current?.click();
            }
          }}
          className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
            hasReadyDocument || isRenderingPdfPreview
              ? 'border-[#B85D19] bg-[#FDF9F3]'
              : 'border-[#D5CEC0] hover:border-[#B85D19] bg-[#F8F5EE]/60 cursor-pointer'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.musicxml,.xml"
            className="hidden"
            onChange={(e) => handleFilesSelect(e.target.files)}
          />

          {isRenderingPdfPreview ? (
            <div className="space-y-3 py-8">
              <Loader2 className="w-8 h-8 mx-auto text-[#B85D19] animate-spin" />
              <p className="text-sm font-semibold text-[#2A2622]">
                Validating PDF &amp; rendering high-resolution page thumbnails...
              </p>
              <p className="text-xs text-[#78716C]">
                Checking page count, orientation, and staff contrast
              </p>
            </div>
          ) : pdfPreview ? (
            <div className="space-y-4 text-left">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-[#E6E0D4] rounded-xl p-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#FDF3EB] border border-[#F5DEC9] flex items-center justify-center text-[#B85D19] shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#2A2622] truncate">
                      {pdfPreview.fileName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6A6258] mt-0.5">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#1F7A4C]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {pdfPreview.pageCount} {pdfPreview.pageCount === 1 ? 'Page' : 'Pages'} Detected
                      </span>
                      <span>•</span>
                      <span className="font-mono">
                        {(pdfPreview.fileSizeBytes / 1024).toFixed(0)} KB
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F3EFE6] hover:bg-[#E6E0D4] text-xs font-semibold text-[#2A2622] cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Replace File
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetAllSelections();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-[#F5C2C7] text-xs font-semibold text-[#B91C1C] hover:bg-[#FDF2F2] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove PDF
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#6A6258]">
                    PDF Page Thumbnails (In Reading Order)
                  </span>
                  <span className="text-[11px] text-[#78716C]">
                    All {pdfPreview.pageCount} {pdfPreview.pageCount === 1 ? 'page' : 'pages'} will be analyzed
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-80 overflow-y-auto p-1">
                  {pdfPreview.pages.map((page) => (
                    <div
                      key={page.pageNumber}
                      className="bg-white border border-[#E6E0D4] rounded-xl p-2 shadow-xs flex flex-col"
                    >
                      <div className="flex items-center justify-between mb-1.5 px-1">
                        <span className="text-[11px] font-mono font-bold text-[#2A2622]">
                          Page {page.pageNumber} of {pdfPreview.pageCount}
                        </span>
                        {page.status === 'ok' ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EBF5EE] text-[#1F7A4C]">
                            Ready
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FDF2F2] text-[#B91C1C]">
                            Error
                          </span>
                        )}
                      </div>
                      {page.thumbnailDataUrl || page.dataUrl ? (
                        <img
                          src={page.thumbnailDataUrl || page.dataUrl}
                          alt={`PDF Page ${page.pageNumber} thumbnail`}
                          className="h-40 w-full rounded-lg object-contain bg-[#FAF8F5] border border-[#F3EFE6]"
                        />
                      ) : (
                        <div className="h-40 w-full rounded-lg bg-[#FDF2F2] flex items-center justify-center p-2 text-[11px] text-[#B91C1C] text-center">
                          {page.error || 'Page could not be rendered'}
                        </div>
                      )}
                      {page.width > 0 && (
                        <span className="text-[10px] font-mono text-[#8C8274] mt-1.5 text-center">
                          {page.width}×{page.height}px
                          {page.rotatedDegrees ? ` • Auto-rotated ${page.rotatedDegrees}°` : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : uploadedXmlContent ? (
            <div className="space-y-3 py-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#EBF5EE] border border-[#C5E3CE] flex items-center justify-center text-[#1F7A4C]">
                <FileCode2 className="w-7 h-7" />
              </div>
              <p className="text-sm font-semibold text-[#2A2622]">
                {uploadedXmlFileName}
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1F7A4C] bg-[#EBF5EE] px-3 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  MusicXML score ready for multi-part analysis
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetAllSelections();
                  }}
                  className="text-xs font-semibold text-[#B91C1C] hover:underline cursor-pointer"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : previewImages.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F7A4C] bg-[#EBF5EE] px-3 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {previewImages.length} {previewImages.length === 1 ? 'Score Image Page' : 'Score Image Pages'} Ready
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622] hover:border-[#B85D19] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Page
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetAllSelections();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#F5C2C7] text-xs font-semibold text-[#B91C1C] hover:bg-[#FDF2F2] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear All
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
                {previewImages.map((src, idx) => (
                  <div
                    key={idx}
                    className="relative group bg-white border border-[#E6E0D4] rounded-xl p-2 shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1.5 px-1">
                      <span className="text-[11px] font-mono font-semibold text-[#6A6258] truncate max-w-[160px]">
                        Page {idx + 1} {imageFileNames[idx] ? `(${imageFileNames[idx]})` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePage(idx);
                        }}
                        className="text-[11px] text-[#B91C1C] hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                    <img
                      src={src}
                      alt={`Uploaded score page ${idx + 1}`}
                      className="max-h-56 w-full mx-auto rounded-lg object-contain bg-[#FAF8F5]"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F3EFE6] flex items-center justify-center text-[#B85D19]">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <p className="text-base font-semibold text-[#2A2622]">
                  Drop a multi-page PDF or sheet music image(s), or click to browse
                </p>
                <p className="text-xs text-[#78716C] mt-1">
                  Supports <strong>PDF (.pdf up to 12 pages / 25 MB)</strong>, <strong>PNG / JPG / JPEG</strong> (up to 15 MB), or <strong>MusicXML (.musicxml)</strong>
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-[#6A6258] bg-white px-3 py-1.5 rounded-lg border border-[#E6E0D4]">
                  <FileText className="w-3.5 h-3.5 text-[#B85D19]" />
                  Multi-Page PDF Scores
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-[#6A6258] bg-white px-3 py-1.5 rounded-lg border border-[#E6E0D4]">
                  <Layers className="w-3.5 h-3.5 text-[#B85D19]" />
                  Multi-System &amp; SATB Parts
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-[#6A6258] bg-white px-3 py-1.5 rounded-lg border border-[#E6E0D4]">
                  <Camera className="w-3.5 h-3.5 text-[#B85D19]" />
                  Original Score Preserved
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="mt-4 p-4 bg-[#FDF2F2] border border-[#F8D7DA] rounded-xl flex items-start gap-3 text-xs text-[#991B1B]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Score Upload / Recognition Issue</p>
              <p className="mt-0.5 leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Analyze Action Button */}
        <button
          onClick={handleAnalyzeSheet}
          disabled={!hasReadyDocument || isAnalyzing || isRenderingPdfPreview}
          className={`mt-5 w-full py-3.5 px-6 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm ${
            !hasReadyDocument || isAnalyzing || isRenderingPdfPreview
              ? 'bg-[#E6E0D4] text-[#9C9488] cursor-not-allowed'
              : 'bg-[#B85D19] hover:bg-[#9F4E12] text-white cursor-pointer'
          }`}
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {pdfPreview
                ? `Recognizing All ${pdfPreview.pageCount} PDF Page(s), Systems, Measures & Solfa...`
                : 'Recognizing All Systems, Staves, Measures & Solfa...'}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {pdfPreview
                ? `Analyze Full PDF Score (${pdfPreview.pageCount} ${pdfPreview.pageCount === 1 ? 'Page' : 'Pages'})`
                : `Analyze Full Score (${previewImages.length > 1 ? `${previewImages.length} Pages` : 'All Systems & Parts'})`}
            </>
          )}
        </button>
      </div>

      {/* Right Column: Instant Choir Practice Library */}
      <div className="lg:col-span-5 bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-2.5 mb-2">
          <BookOpen className="w-5 h-5 text-[#B85D19]" />
          <h3 className="text-xl font-serif font-bold text-[#2A2622]">
            Choir Practice Library
          </h3>
        </div>
        <p className="text-xs text-[#6A6258] mb-5 leading-relaxed">
          No sheet music handy? Select a classic hymn, warm-up scale, or sight-singing exercise to explore Solfa syllables and practice mode immediately.
        </p>

        <div className="space-y-3">
          {SAMPLE_SCORES.map((sample) => (
            <button
              key={sample.id}
              onClick={() => onScoreAnalyzed(sample)}
              className="w-full text-left p-4 rounded-xl bg-white hover:bg-[#FDF6EE] border border-[#E6E0D4] hover:border-[#D9A77B] transition-all group flex items-center justify-between gap-4 cursor-pointer"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#F3EFE6] text-[#7A6F61]">
                    Sample Score
                  </span>
                  <span className="text-xs font-mono text-[#8C8274]">
                    {sample.keySignature.key} • {sample.timeSignature.numerator}/{sample.timeSignature.denominator}
                  </span>
                </div>
                <h4 className="font-serif font-bold text-base text-[#2A2622] group-hover:text-[#B85D19] mt-1 transition-colors">
                  {sample.title}
                </h4>
                <p className="text-xs text-[#78716C] mt-0.5">{sample.composer}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-[#F3EFE6] group-hover:bg-[#B85D19] text-[#6A6258] group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                <Music className="w-4 h-4" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
