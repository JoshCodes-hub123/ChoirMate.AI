import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  FileText,
  Image as ImageIcon,
  FileCode2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  Sparkles,
  Plus,
  RefreshCw,
  ArrowRight,
  Info,
  Music,
} from 'lucide-react';
import {
  HealthStatus,
  PdfPreviewPage,
  ScoreAnalysis,
  SectionDiagnostic,
} from '../types/music';
import {
  analyzeUploadedScore,
  ChoirMateApiError,
  fetchHealthStatus,
  previewPdfDocument,
} from '../services/api';
import { SAMPLE_SCORES } from '../data/sampleScores';

interface SheetWorkspaceProps {
  onAnalysisComplete: (score: ScoreAnalysis) => void;
  onSelectDemoScore: (score: ScoreAnalysis) => void;
  activeScore: ScoreAnalysis | null;
}

type UploadMode = 'none' | 'musicxml' | 'image' | 'pdf';

export const SheetWorkspace: React.FC<SheetWorkspaceProps> = ({
  onAnalysisComplete,
  onSelectDemoScore,
  activeScore,
}) => {
  const [uploadMode, setUploadMode] = useState<UploadMode>('none');
  const [fileName, setFileName] = useState<string>('');
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);

  // MusicXML payload state
  const [musicXmlContent, setMusicXmlContent] = useState<string>('');

  // Image payload state (supports single or multi-page images)
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [activePreviewPage, setActivePreviewPage] = useState<number>(0);

  // PDF payload state
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<PdfPreviewPage[]>([]);
  const [isRenderingPdf, setIsRenderingPdf] = useState<boolean>(false);
  const [pdfPreviewWarning, setPdfPreviewWarning] = useState<string | null>(null);

  // Optional score metadata overrides
  const [scoreTitle, setScoreTitle] = useState<string>('');
  const [scoreComposer, setScoreComposer] = useState<string>('');
  const [targetTempo, setTargetTempo] = useState<number>(88);

  // Analysis progress & error states
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStageText, setAnalysisStageText] = useState<string>('');
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    errorCode?: string;
    diagnostics?: SectionDiagnostic[];
  } | null>(null);

  // Live backend health
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addPageInputRef = useRef<HTMLInputElement | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchHealthStatus(ctrl.signal)
      .then((status) => setHealth(status))
      .catch(() => {});
    return () => {
      ctrl.abort();
      activeAbortRef.current?.abort();
    };
  }, []);

  const resetUploadSelection = () => {
    activeAbortRef.current?.abort();
    setUploadMode('none');
    setFileName('');
    setFileSizeBytes(0);
    setMusicXmlContent('');
    setPageImages([]);
    setActivePreviewPage(0);
    setPdfBase64(null);
    setPdfPages([]);
    setIsRenderingPdf(false);
    setPdfPreviewWarning(null);
    setScoreTitle('');
    setScoreComposer('');
    setErrorState(null);
    setIsAnalyzing(false);
    setAnalysisStageText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deriveCleanTitle = (rawName: string): string => {
    return (
      rawName
        .replace(/\.(musicxml|xml|pdf|png|jpe?g|webp)$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim() || 'Uploaded Choral Score'
    );
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Could not read file as base64 data URL.'));
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsDataURL(file);
    });

  /**
   * Normalizes uploaded sheet-music images so high-resolution camera photos (> 2.2 MB)
   * stay safely within Vercel's 4.5 MB Serverless Function payload limit while
   * preserving crisp ~2200px resolution on a white background for HOMR recognition.
   */
  const normalizeImageDataUrlForOmr = async (file: File): Promise<string> => {
    const rawDataUrl = await readFileAsDataUrl(file);
    if (file.size <= 2_200_000) {
      return rawDataUrl;
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 2200;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    });
  };

  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Could not read text file.'));
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsText(file);
    });

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    // Cancel any previous in-flight request and clear stale errors
    activeAbortRef.current?.abort();
    setErrorState(null);
    setPdfPreviewWarning(null);

    const first = files[0];
    const lowerName = first.name.toLowerCase();

    // 1. MusicXML file (.musicxml or .xml)
    if (
      lowerName.endsWith('.musicxml') ||
      lowerName.endsWith('.xml') ||
      first.type === 'application/vnd.recordare.musicxml+xml' ||
      first.type === 'text/xml' ||
      first.type === 'application/xml'
    ) {
      try {
        const xmlText = await readFileAsText(first);
        if (!xmlText.includes('<score-partwise') && !xmlText.includes('<score-timewise') && !xmlText.includes('<part')) {
          setErrorState({
            title: 'Invalid MusicXML File',
            message: `The file "${first.name}" does not contain valid MusicXML elements (<score-partwise> or <part>).`,
            errorCode: 'INVALID_MUSICXML_SYNTAX',
          });
          return;
        }
        setUploadMode('musicxml');
        setFileName(first.name);
        setFileSizeBytes(first.size);
        setMusicXmlContent(xmlText);
        setPageImages([]);
        setPdfBase64(null);
        setPdfPages([]);
        setScoreTitle(deriveCleanTitle(first.name));
      } catch (err: any) {
        setErrorState({
          title: 'File Read Error',
          message: err?.message || 'Could not read MusicXML file.',
        });
      }
      return;
    }

    // 2. PDF file (.pdf)
    if (lowerName.endsWith('.pdf') || first.type === 'application/pdf') {
      try {
        const dataUrl = await readFileAsDataUrl(first);
        setUploadMode('pdf');
        setFileName(first.name);
        setFileSizeBytes(first.size);
        setPdfBase64(dataUrl);
        setMusicXmlContent('');
        setPageImages([]);
        setPdfPages([]);
        setScoreTitle(deriveCleanTitle(first.name));

        // Attempt real PDF preview via Python pdf_processor
        setIsRenderingPdf(true);
        const abortCtrl = new AbortController();
        activeAbortRef.current = abortCtrl;
        try {
          const previewRes = await previewPdfDocument(dataUrl, first.name, abortCtrl.signal);
          if (previewRes.pages && previewRes.pages.length > 0) {
            setPdfPages(previewRes.pages);
            setPageImages(previewRes.pages.map((p) => p.dataUrl));
          }
        } catch (previewErr: any) {
          if (previewErr?.name !== 'AbortError') {
            setPdfPreviewWarning(
              previewErr?.message ||
                'PDF page thumbnail rendering is unavailable in this environment; your PDF payload is still staged for backend analysis.'
            );
          }
        } finally {
          setIsRenderingPdf(false);
        }
      } catch (err: any) {
        setIsRenderingPdf(false);
        setErrorState({
          title: 'PDF Load Error',
          message: err?.message || 'Could not read the selected PDF document.',
        });
      }
      return;
    }

    // 3. Sheet Music Image files (.png, .jpg, .jpeg, .webp)
    const imageFiles = files.filter(
      (f) =>
        f.type.startsWith('image/') ||
        /\.(png|jpe?g|webp)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      setErrorState({
        title: 'Unsupported File Format',
        message: `Could not load "${first.name}". Please upload a MusicXML file (.musicxml, .xml), a sheet music image (.png, .jpg, .webp), or a PDF score (.pdf).`,
        errorCode: 'UNSUPPORTED_FILE_TYPE',
      });
      return;
    }

    try {
      const dataUrls = await Promise.all(imageFiles.map((f) => normalizeImageDataUrlForOmr(f)));
      setUploadMode('image');
      setFileName(
        imageFiles.length === 1
          ? imageFiles[0].name
          : `${imageFiles[0].name} (+${imageFiles.length - 1} more)`
      );
      setFileSizeBytes(imageFiles.reduce((acc, f) => acc + f.size, 0));
      setPageImages(dataUrls);
      setActivePreviewPage(0);
      setMusicXmlContent('');
      setPdfBase64(null);
      setPdfPages([]);
      setScoreTitle(deriveCleanTitle(imageFiles[0].name));
    } catch (err: any) {
      setErrorState({
        title: 'Image Read Error',
        message: err?.message || 'Could not read the uploaded image file.',
      });
    }
  };

  const handleAddMoreImagePages = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const imageFiles = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name)
    );
    if (imageFiles.length === 0) return;
    try {
      const newUrls = await Promise.all(imageFiles.map((f) => normalizeImageDataUrlForOmr(f)));
      setPageImages((prev) => [...prev, ...newUrls]);
    } catch {
      // ignore
    }
  };

  const handleRunAnalysis = async () => {
    if (uploadMode === 'none') return;

    activeAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    activeAbortRef.current = abortCtrl;

    setIsAnalyzing(true);
    setErrorState(null);

    try {
      if (uploadMode === 'musicxml') {
        setAnalysisStageText(
          'Parsing MusicXML staves, extracting SATB vocal parts, computing movable-Do solfa & rhythm breakdown...'
        );
      } else if (uploadMode === 'pdf') {
        setAnalysisStageText(
          'Sending PDF score to Python HOMR Optical Music Recognition & Music Theory pipeline...'
        );
      } else {
        setAnalysisStageText(
          `Running Python HOMR Optical Music Recognition on ${pageImages.length} page${
            pageImages.length > 1 ? 's' : ''
          }...`
        );
      }

      const result = await analyzeUploadedScore(
        {
          musicxml: uploadMode === 'musicxml' ? musicXmlContent : undefined,
          pdfBase64: uploadMode === 'pdf' && pdfBase64 ? pdfBase64 : undefined,
          pdfFileName: uploadMode === 'pdf' ? fileName : undefined,
          imageBase64: uploadMode === 'image' && pageImages.length === 1 ? pageImages[0] : undefined,
          pages: uploadMode === 'image' && pageImages.length > 1 ? pageImages : undefined,
          title: scoreTitle.trim() || deriveCleanTitle(fileName),
          composer: scoreComposer.trim() || 'Uploaded Score',
          tempo: targetTempo || 88,
        },
        abortCtrl.signal,
        (jobState, elapsedSeconds) => {
          const elapsedTag = elapsedSeconds > 0 ? ` (${Math.round(elapsedSeconds)}s elapsed)` : '';
          if (jobState === 'queued') {
            setAnalysisStageText(
              `Queued on Python HOMR recognition worker${elapsedTag} — waiting for active job to finish...`
            );
          } else {
            setAnalysisStageText(
              uploadMode === 'pdf'
                ? `Running Python HOMR Optical Music Recognition on PDF score${elapsedTag}...`
                : `Running Python HOMR Optical Music Recognition on ${pageImages.length} page${
                    pageImages.length > 1 ? 's' : ''
                  }${elapsedTag}...`
            );
          }
        }
      );

      if (!result.data) {
        throw new ChoirMateApiError(
          'Backend returned an empty score analysis payload.',
          500,
          'EMPTY_ANALYSIS_DATA'
        );
      }

      const restoredPageImages =
        Array.isArray(result.data.pageImages) && result.data.pageImages.length > 0
          ? result.data.pageImages
          : pageImages.length > 0
          ? pageImages
          : undefined;
      const restoredImageUrl =
        result.data.imageUrl ||
        (restoredPageImages && restoredPageImages.length > 0
          ? restoredPageImages[0]
          : undefined);

      const analyzedScore: ScoreAnalysis = {
        ...result.data,
        isDemonstration: false,
        title: result.data.title || scoreTitle.trim() || deriveCleanTitle(fileName),
        rawMusicXml:
          result.data.rawMusicXml ||
          (uploadMode === 'musicxml' ? musicXmlContent : undefined),
        imageUrl: restoredImageUrl,
        pageImages: restoredPageImages,
      };

      setIsAnalyzing(false);
      setAnalysisStageText('');
      onAnalysisComplete(analyzedScore);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setIsAnalyzing(false);
        setAnalysisStageText('');
        return;
      }

      setIsAnalyzing(false);
      setAnalysisStageText('');

      if (err instanceof ChoirMateApiError) {
        setErrorState({
          title:
            err.errorCode === 'HOMR_ENVIRONMENT_REQUIRED' ||
            err.errorCode === 'PDF_PROCESSOR_UNAVAILABLE'
              ? 'Sheet Music Image Recognition is Temporarily Unavailable'
              : 'Score Analysis Could Not Complete',
          message: err.message,
          errorCode: err.errorCode,
          diagnostics: err.diagnostics,
        });
      } else {
        setErrorState({
          title: 'Score Analysis Failed',
          message:
            err instanceof Error
              ? err.message
              : 'An unexpected error occurred while communicating with the Python analysis service.',
        });
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-8 sm:py-10 text-[#16221A]">
      {/* Page Title & Engine Status Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#DFD6C3]">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-[#9E7B35]">
            Score Upload & Analysis Workspace
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#143826] mt-1">
            Analyze Your Sheet Music
          </h1>
          <p className="text-sm text-[#4F5F56] mt-1">
            Upload a MusicXML score, sheet music image, or PDF. ChoirMate AI processes your real file—never substituting hidden demo music.
          </p>
        </div>

        {/* Live Backend Status Readout */}
        <div className="bg-white rounded-xl border border-[#DFD6C3] px-4 py-3 flex flex-wrap items-center gap-4 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                health?.pythonServiceActive ? 'bg-[#1D7A4C]' : 'bg-[#C4962C]'
              }`}
            />
            <span className="font-semibold text-[#16221A]">
              Python Engine:{' '}
              {health?.pythonServiceActive
                ? health.pythonBackendMode === 'remote'
                  ? 'Connected (Remote Server)'
                  : 'Online (Local Service)'
                : 'Offline'}
            </span>
          </div>
          <div className="h-4 w-px bg-[#E5DEC9] hidden sm:block" />
          <div className="flex items-center gap-3 text-[11px] text-[#4F5F56]">
            <span>
              MusicXML & SATB:{' '}
              <strong className="text-[#1D7A4C]">Ready</strong>
            </span>
            <span>•</span>
            <span>
              Image Recognition (HOMR):{' '}
              <strong className={health?.omrAvailable ? 'text-[#1D7A4C]' : 'text-[#8B6914]'}>
                {health?.omrAvailable ? 'Ready' : 'Temporarily Unavailable'}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Friendly Notice when HOMR Image Recognition is Temporarily Unavailable */}
      {health && !health.omrAvailable && (
        <div className="mt-6 bg-[#FDF6E4] border border-[#E8CF8C] rounded-2xl p-4 sm:p-5 flex items-start gap-3 text-[#6E500C]">
          <Info className="w-5 h-5 text-[#9E7B35] shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm space-y-1">
            <p className="font-bold text-[#5A4008]">
              Image &amp; PDF Recognition is Temporarily Unavailable
            </p>
            <p className="leading-relaxed">
              Optical Music Recognition (HOMR) for printed sheet-music images and PDFs is currently offline in this environment.{' '}
              <strong className="font-semibold">
                MusicXML (<code>.musicxml</code> / <code>.xml</code>) uploads, SATB Voice Studio extraction, and WAV/MP3 rehearsal audio generation are 100% active and ready to use right now.
              </strong>
            </p>
          </div>
        </div>
      )}

      {/* Main Two-Column Upload & Preview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
        {/* Left Column (7 cols): Upload Dropzone or Staged File Preview */}
        <div className="lg:col-span-7 space-y-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".musicxml,.xml,.pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,application/pdf,text/xml,application/xml"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFilesSelected(e.target.files);
              }
            }}
          />

          <input
            ref={addPageInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleAddMoreImagePages(e.target.files)}
          />

          {uploadMode === 'none' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleFilesSelected(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all cursor-pointer ${
                isDragging
                  ? 'border-[#143826] bg-[#143826]/5'
                  : 'border-[#C9BEA9] bg-white hover:border-[#143826] hover:bg-[#FCF9F3]'
              }`}
            >
              <div className="w-16 h-16 rounded-2xl bg-[#143826]/10 text-[#143826] flex items-center justify-center mx-auto mb-5">
                <Upload className="w-8 h-8" />
              </div>

              <h2 className="font-serif text-2xl font-bold text-[#143826]">
                Drop your sheet music here, or click to browse
              </h2>
              <p className="text-sm text-[#526258] mt-2 max-w-md mx-auto">
                Supports multi-part MusicXML (<code>.musicxml</code>, <code>.xml</code>), sheet music images (<code>.png</code>, <code>.jpg</code>, <code>.webp</code>), and score PDFs (<code>.pdf</code>).
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <span className="px-4 py-2.5 rounded-xl bg-[#143826] text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs">
                  <Upload className="w-4 h-4" />
                  Select File from Device
                </span>
              </div>

              <div className="mt-8 pt-6 border-t border-[#EAE2D2] grid grid-cols-1 sm:grid-cols-3 gap-4 text-left text-xs text-[#4F5F56]">
                <div className="p-3 rounded-xl bg-[#FAF5ED] border border-[#E6DEC8]">
                  <div className="font-semibold text-[#143826] flex items-center gap-1.5 mb-1">
                    <FileCode2 className="w-4 h-4 text-[#9E7B35]" />
                    <span>MusicXML (.xml)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    100% exact note, lyric, and multi-staff SATB voice extraction via our Python parser.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF5ED] border border-[#E6DEC8]">
                  <div className="font-semibold text-[#143826] flex items-center gap-1.5 mb-1">
                    <ImageIcon className="w-4 h-4 text-[#9E7B35]" />
                    <span>Sheet Images</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Clear, well-lit photos or scans of printed staves processed via Python HOMR OMR.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-[#FAF5ED] border border-[#E6DEC8]">
                  <div className="font-semibold text-[#143826] flex items-center gap-1.5 mb-1">
                    <FileText className="w-4 h-4 text-[#9E7B35]" />
                    <span>Multi-Page PDF</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Full choral octavos rendered page-by-page and analyzed into vocal parts.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Staged File Card */
            <div className="bg-white rounded-2xl border border-[#DFD6C3] shadow-xs overflow-hidden">
              <div className="bg-[#143826] text-white px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {uploadMode === 'musicxml' && <FileCode2 className="w-5 h-5 text-[#D6B872] shrink-0" />}
                  {uploadMode === 'image' && <ImageIcon className="w-5 h-5 text-[#D6B872] shrink-0" />}
                  {uploadMode === 'pdf' && <FileText className="w-5 h-5 text-[#D6B872] shrink-0" />}
                  <div className="truncate">
                    <span className="text-[10px] uppercase tracking-widest text-[#D6B872] font-bold block">
                      Staged {uploadMode.toUpperCase()} Upload
                    </span>
                    <h2 className="font-serif text-base font-bold truncate">{fileName}</h2>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Replace File</span>
                  </button>
                  <button
                    type="button"
                    onClick={resetUploadSelection}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-red-500/30 text-white transition-colors cursor-pointer"
                    aria-label="Remove file"
                    title="Clear uploaded file"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Preview Body */}
              <div className="p-5 space-y-4">
                {uploadMode === 'musicxml' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-[#4F5F56] bg-[#F5F0E4] px-4 py-2.5 rounded-xl border border-[#E2D9C5]">
                      <span>
                        File Size: <strong className="text-[#16221A]">{(fileSizeBytes / 1024).toFixed(1)} KB</strong>
                      </span>
                      <span className="text-[#1D7A4C] font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Valid MusicXML Document Ready
                      </span>
                    </div>
                    <div className="bg-[#16221A] text-[#E6EFE9] p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-60">
                      <pre className="whitespace-pre-wrap break-words">
                        {musicXmlContent.slice(0, 1200)}
                        {musicXmlContent.length > 1200 ? '\n... [MusicXML content continues]' : ''}
                      </pre>
                    </div>
                  </div>
                )}

                {uploadMode === 'image' && pageImages.length > 0 && (
                  <div className="space-y-4">
                    <div className="bg-[#FAF5ED] border border-[#E2D9C5] rounded-xl p-3 flex items-center justify-center max-h-[420px] overflow-hidden">
                      <img
                        src={pageImages[activePreviewPage] || pageImages[0]}
                        alt={`Uploaded score page ${activePreviewPage + 1}`}
                        className="max-h-[390px] w-auto object-contain rounded-lg shadow-xs"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 overflow-x-auto py-1">
                        {pageImages.map((imgUrl, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActivePreviewPage(idx)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                              activePreviewPage === idx
                                ? 'bg-[#143826] text-white border-[#143826]'
                                : 'bg-white text-[#16221A] border-[#DFD6C3] hover:bg-[#F5EFE2]'
                            }`}
                          >
                            Page {idx + 1}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => addPageInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg border border-[#143826]/30 hover:bg-[#143826]/5 text-[#143826] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Another Page</span>
                      </button>
                    </div>
                  </div>
                )}

                {uploadMode === 'pdf' && (
                  <div className="space-y-4">
                    {isRenderingPdf ? (
                      <div className="py-12 text-center space-y-2 bg-[#FAF5ED] rounded-xl border border-[#E2D9C5]">
                        <Loader2 className="w-7 h-7 animate-spin text-[#143826] mx-auto" />
                        <p className="text-xs font-semibold text-[#143826]">
                          Rendering PDF pages via Python PDF processor...
                        </p>
                      </div>
                    ) : pdfPages.length > 0 ? (
                      <div className="space-y-3">
                        <div className="bg-[#FAF5ED] border border-[#E2D9C5] rounded-xl p-3 flex items-center justify-center max-h-[400px] overflow-hidden">
                          <img
                            src={pdfPages[activePreviewPage]?.dataUrl || pdfPages[0].dataUrl}
                            alt={`PDF page ${activePreviewPage + 1}`}
                            className="max-h-[370px] w-auto object-contain rounded-lg"
                          />
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto">
                          {pdfPages.map((p, idx) => (
                            <button
                              key={p.pageNumber}
                              type="button"
                              onClick={() => setActivePreviewPage(idx)}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                                activePreviewPage === idx
                                  ? 'bg-[#143826] text-white border-[#143826]'
                                  : 'bg-white text-[#16221A] border-[#DFD6C3]'
                              }`}
                            >
                              Page {p.pageNumber}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-[#FDF6E4] border border-[#E8CF8C] text-xs text-[#7D5B0F] flex items-start gap-2.5">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">
                            PDF Staged: {fileName} ({(fileSizeBytes / 1024).toFixed(1)} KB)
                          </p>
                          {pdfPreviewWarning && <p className="mt-1">{pdfPreviewWarning}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Honest Error Diagnostic Card (NEVER falls back to built-in demo music) */}
          {errorState && (
            <div
              role="alert"
              className="bg-[#FDF2F2] border-2 border-[#E6B8B8] rounded-2xl p-6 text-[#691B1B] space-y-3 shadow-xs"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-serif text-lg font-bold text-[#7F1D1D]">
                      {errorState.title}
                    </h3>
                    {errorState.errorCode && (
                      <span className="font-mono text-[11px] font-semibold bg-white/80 border border-[#E6B8B8] px-2.5 py-0.5 rounded-md">
                        {errorState.errorCode}
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm leading-relaxed text-[#7F1D1D]/90">
                    {errorState.message}
                  </p>
                </div>
              </div>

              {errorState.diagnostics && errorState.diagnostics.length > 0 && (
                <div className="pt-2 border-t border-[#F1D2D2] space-y-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider block">
                    Backend Engine Diagnostics:
                  </span>
                  <ul className="list-disc list-inside text-xs space-y-1">
                    {errorState.diagnostics.map((diag, i) => (
                      <li key={i}>
                        {diag.pageNumber ? `Page ${diag.pageNumber}: ` : ''}
                        {diag.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-3 border-t border-[#F1D2D2] flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl bg-[#7F1D1D] hover:bg-[#991B1B] text-white text-xs font-semibold cursor-pointer"
                >
                  Upload a Different File (or MusicXML .xml)
                </button>
                <span className="text-[11px] text-[#7F1D1D]/80">
                  ChoirMate AI never replaces failed uploads with built-in demo songs.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Score Metadata & Run Analysis Action */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl border border-[#DFD6C3] p-6 space-y-5 shadow-xs">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#9E7B35]">
                Analysis Configuration
              </span>
              <h2 className="font-serif text-xl font-bold text-[#143826] mt-0.5">
                Score Details & Recognition
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="score-title-input"
                  className="block text-xs font-semibold text-[#334239] mb-1"
                >
                  Score Title (Optional override)
                </label>
                <input
                  id="score-title-input"
                  type="text"
                  value={scoreTitle}
                  onChange={(e) => setScoreTitle(e.target.value)}
                  placeholder="Detected from file or enter title..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D8CBB3] bg-[#FAF5ED] text-sm text-[#16221A] focus:outline-none focus:border-[#143826]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="score-composer-input"
                    className="block text-xs font-semibold text-[#334239] mb-1"
                  >
                    Composer / Arranger
                  </label>
                  <input
                    id="score-composer-input"
                    type="text"
                    value={scoreComposer}
                    onChange={(e) => setScoreComposer(e.target.value)}
                    placeholder="e.g., J.S. Bach"
                    className="w-full px-3 py-2 rounded-xl border border-[#D8CBB3] bg-[#FAF5ED] text-xs text-[#16221A] focus:outline-none focus:border-[#143826]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="score-tempo-input"
                    className="block text-xs font-semibold text-[#334239] mb-1"
                  >
                    Default Tempo (BPM)
                  </label>
                  <input
                    id="score-tempo-input"
                    type="number"
                    min={36}
                    max={220}
                    value={targetTempo}
                    onChange={(e) => setTargetTempo(Number(e.target.value) || 88)}
                    className="w-full px-3 py-2 rounded-xl border border-[#D8CBB3] bg-[#FAF5ED] text-xs font-mono text-[#16221A] focus:outline-none focus:border-[#143826]"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={uploadMode === 'none' || isAnalyzing || isRenderingPdf}
              onClick={handleRunAnalysis}
              className="w-full py-3.5 px-5 rounded-xl bg-[#143826] hover:bg-[#1B4B33] disabled:opacity-45 text-white font-semibold text-sm transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Analyzing Uploaded Score...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#D6B872] shrink-0" />
                  <span>Analyze Uploaded Score</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </>
              )}
            </button>

            {isAnalyzing && analysisStageText && (
              <div className="p-3.5 rounded-xl bg-[#F2ECE1] border border-[#DFD6C3] text-xs text-[#143826] flex items-start gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5 text-[#9E7B35]" />
                <div>
                  <span className="font-semibold block">Processing in Python Engine</span>
                  <span className="text-[#4F5F56] mt-0.5 block">{analysisStageText}</span>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[#EFE8DA] text-[11px] text-[#5B6B61] space-y-1.5">
              <p className="font-semibold text-[#143826]">What happens during analysis:</p>
              <p>• Extracts vocal parts, clefs, key signature, and time signature.</p>
              <p>• Computes movable-Do solfa syllables and beat-by-beat rhythm counts.</p>
              <p>• Prepares raw MusicXML for SATB Voice Studio synthesis and WAV/MP3 export.</p>
            </div>
          </div>

          {/* Separate, Explicitly Labeled Demo Mode Section */}
          <div className="bg-[#FAF5ED] rounded-2xl border border-[#DFD6C3] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B6914] bg-[#FDF6E4] border border-[#E8CF8C] px-2.5 py-0.5 rounded-md">
                Optional Demo Mode
              </span>
              <span className="text-[11px] text-[#637269]">Clearly labeled reference scores</span>
            </div>

            <p className="text-xs text-[#4F5F56] leading-relaxed">
              Want to explore the interface with a pre-analyzed score? Select a labeled Demo Score below:
            </p>

            <div className="space-y-2">
              {SAMPLE_SCORES.map((demo) => {
                const isCurrent = activeScore?.id === demo.id;
                return (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => onSelectDemoScore(demo)}
                    className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                      isCurrent
                        ? 'bg-[#143826] text-white border-[#143826]'
                        : 'bg-white hover:bg-[#FCF9F3] text-[#16221A] border-[#E2D9C5]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Music className="w-3.5 h-3.5 text-[#9E7B35] shrink-0" />
                        <span className="text-xs font-bold truncate">{demo.title}</span>
                      </div>
                      <span
                        className={`text-[11px] block mt-0.5 ${
                          isCurrent ? 'text-white/80' : 'text-[#637269]'
                        }`}
                      >
                        {demo.keySignature.key} • {demo.timeSignature.numerator}/{demo.timeSignature.denominator} •{' '}
                        {(demo.parts || []).length} Vocal Parts
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md shrink-0 ${
                        isCurrent
                          ? 'bg-white/20 text-white'
                          : 'bg-[#FDF6E4] text-[#8B6914] border border-[#E8CF8C]'
                      }`}
                    >
                      Load Demo
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
