import React, { useState, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality, Part } from "@google/genai";

// --- Constants ---
const API_MODEL = 'gemini-2.5-flash-image-preview';
const STYLES = {
  photorealistic: "超擬真",
  cute: "可愛",
  abstract: "抽象",
  picasso: "畢卡索",
  vangogh: "梵谷",
  davinci: "達文西",
  monalisa: "蒙娜麗莎",
  mosaic: "馬賽克",
  custom: "其他..."
};
const RANDOM_ACTIONS = ["跑步", "揮手", "拿著咖啡", "跳舞", "思考", "慶祝"];
const MAX_CUSTOM_VARIANTS = 12;

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<{ data: string, mimeType: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        const result = reader.result as string;
        const [header, data] = result.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
        resolve({ data, mimeType });
    };
    reader.onerror = error => reject(error);
  });
};

const downloadDataUrl = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

const downloadJson = (data: object, filename: string) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, filename);
    URL.revokeObjectURL(url);
};

// --- App Component ---
const App: React.FC = () => {
    // State Management
    const [uploadedImage, setUploadedImage] = useState<{ url: string; base64: string; mimeType: string; } | null>(null);
    const [consentChecked, setConsentChecked] = useState<boolean>(false);
    
    // Generation Settings
    const [style, setStyle] = useState<string>('cute');
    const [customStyle, setCustomStyle] = useState<string>('');
    const [styleStrength, setStyleStrength] = useState<number>(70);
    const [userPrompt, setUserPrompt] = useState<string>('');
    const [lockCharacter, setLockCharacter] = useState<boolean>(true);
    const [faceConsistency, setFaceConsistency] = useState<boolean>(false);
    
    // Text Intent & Custom Variants
    const [textIntent, setTextIntent] = useState('');
    const [textMode, setTextMode] = useState<'guide_only' | 'render_to_image'>('guide_only');
    const [customVariantsPrompt, setCustomVariantsPrompt] = useState<string>('yes, no, ok, 生氣, 不要, 不可以, 考試100分, 敲木魚');

    // App State
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [appStep, setAppStep] = useState<'upload' | 'base_generated' | 'variants_generated'>('upload');

    // Generated Content
    const [baseSticker, setBaseSticker] = useState<string | null>(null);
    const [variants, setVariants] = useState<{ id: string, uri: string, label: string }[]>([]);

    const ai = useMemo(() => {
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            console.error("API_KEY environment variable not set.");
            setError("無法初始化 AI 服務：缺少 API 金鑰。");
            return null;
        }
        return new GoogleGenAI({ apiKey });
    }, []);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const { data, mimeType } = await fileToBase64(file);
                setUploadedImage({ url: URL.createObjectURL(file), base64: data, mimeType });
                setError(null);
                resetGeneration();
            } catch (err) {
                console.error("Error reading file:", err);
                setError("讀取檔案失敗，請再試一次。");
            }
        }
    };

    const resetGeneration = () => {
        setAppStep('upload');
        setBaseSticker(null);
        setVariants([]);
    };

    const generateImage = useCallback(async (promptText: string): Promise<string | null> => {
        if (!ai || !uploadedImage) {
            setError("AI 服務未就緒或未上傳圖片。");
            return null;
        }

        const imagePart: Part = {
            inlineData: {
                data: uploadedImage.base64,
                mimeType: uploadedImage.mimeType,
            },
        };
        const textPart: Part = { text: promptText };

        try {
            const response = await ai.models.generateContent({
                model: API_MODEL,
                contents: { parts: [imagePart, textPart] },
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                },
            });
            
            for (const part of response.candidates?.[0]?.content?.parts ?? []) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
            throw new Error("API 未返回圖片。");
        } catch (err) {
            console.error("Gemini API error:", err);
            setError(`圖片生成失敗: ${err instanceof Error ? err.message : '未知錯誤'}`);
            return null;
        }
    }, [ai, uploadedImage]);


    const handleGenerateBase = async () => {
        setError(null);
        setIsLoading(true);
        setLoadingMessage("正在生成您的主體貼圖...");

        const stylePrompt = style === 'custom' ? customStyle : STYLES[style as keyof typeof STYLES];
        const prompt = `Generate a sticker with a transparent background. The subject should be based on the provided image, but rendered in a "${stylePrompt}" style. ${userPrompt ? `Incorporate this description: "${userPrompt}".` : ''} Style strength should be around ${styleStrength}%. ${lockCharacter ? 'Maintain character consistency.' : ''} ${faceConsistency ? 'Pay close attention to face consistency.' : ''}`;

        const result = await generateImage(prompt);
        if (result) {
            setBaseSticker(result);
            setAppStep('base_generated');
        }
        setIsLoading(false);
    };
    
    const generateVariants = async (actions: string[]) => {
        setError(null);
        setIsLoading(true);
        setVariants([]);

        const stylePrompt = style === 'custom' ? customStyle : STYLES[style as keyof typeof STYLES];
        const generatedVariants = [];

        for (const action of actions) {
            setLoadingMessage(`正在生成變化款: ${action}...`);
            const prompt = `Based on the character in the image, create a sticker of them showing the emotion or action: "${action}". The style should be "${stylePrompt}" with a transparent background. ${userPrompt ? `Incorporate this general theme: "${userPrompt}".` : ''} ${lockCharacter ? 'Maintain character consistency.' : ''} ${faceConsistency ? 'Pay close attention to face consistency.' : ''}`;
            const result = await generateImage(prompt);
            if (result) {
                generatedVariants.push({ id: `v${generatedVariants.length + 1}`, uri: result, label: action });
            } else {
                 setError(`生成 "${action}" 變化款失敗。`);
                 // continue to next variant even if one fails
            }
        }
        setVariants(generatedVariants);
        setAppStep('variants_generated');
        setIsLoading(false);
    }

    const handleGenerateVariants = async () => {
        setLoadingMessage("正在生成三款隨機變化貼圖...");
        const randomActions = [...RANDOM_ACTIONS].sort(() => 0.5 - Math.random()).slice(0, 3);
        await generateVariants(randomActions);
    };

    const handleGenerateCustomVariants = async () => {
        const actions = customVariantsPrompt
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, MAX_CUSTOM_VARIANTS);

        if (actions.length === 0) {
            setError("請輸入至少一個有效的情境。");
            return;
        }
        setLoadingMessage("正在生成自訂變化貼圖...");
        await generateVariants(actions);
    };

    const handleExportMetadata = () => {
        const metadata = {
            style,
            customStyle: style === 'custom' ? customStyle : undefined,
            styleStrength,
            userPrompt,
            lockCharacter,
            faceConsistency,
            textIntent,
            textMode,
            timestamp: new Date().toISOString(),
            model: API_MODEL
        };
        downloadJson(metadata, 'metadata.json');
    };

    const isGenerateButtonDisabled = !uploadedImage || !consentChecked || isLoading;

    return (
        <div className="container">
            <header>
                <h1>貼圖製作工具人</h1>
                <p>上傳照片，選擇風格，讓 AI 為您創造獨一無二的貼圖！</p>
            </header>

            <main>
                <aside className="controls-panel">
                    <div className="card">
                        <h2>1. 上傳照片</h2>
                        <div className="form-group">
                            <label htmlFor="image-upload" className="upload-area">
                                <p>點擊或拖曳檔案到此處</p>
                            </label>
                            <input id="image-upload" type="file" accept="image/png, image/jpeg, image/webp" onChange={handleFileChange} hidden />
                            {uploadedImage && <img src={uploadedImage.url} alt="Uploaded preview" className="image-preview" />}
                        </div>
                        <div className="form-group">
                            <label className="checkbox-group">
                                <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
                                我聲明擁有此照片的肖像權或使用授權。
                            </label>
                        </div>
                    </div>

                    <div className="card">
                        <h2>2. 風格設定</h2>
                        <div className="form-group">
                            <label htmlFor="style-select">風格</label>
                            <select id="style-select" className="select" value={style} onChange={e => setStyle(e.target.value)}>
                                {Object.entries(STYLES).map(([key, value]) => (
                                    <option key={key} value={key}>{value}</option>
                                ))}
                            </select>
                        </div>
                        {style === 'custom' && (
                            <div className="form-group">
                                <label htmlFor="custom-style">自訂風格描述</label>
                                <input id="custom-style" type="text" className="input" value={customStyle} onChange={e => setCustomStyle(e.target.value)} placeholder="例如：水墨畫風格" />
                            </div>
                        )}
                        <div className="form-group">
                            <label>風格強度: {styleStrength}</label>
                            <div className="slider-group">
                                <span>0</span>
                                <input type="range" min="0" max="100" value={styleStrength} onChange={e => setStyleStrength(Number(e.target.value))} />
                                <span>100</span>
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="checkbox-group">
                                <input type="checkbox" checked={lockCharacter} onChange={e => setLockCharacter(e.target.checked)} />
                                角色鎖定
                            </label>
                             <label className="checkbox-group">
                                <input type="checkbox" checked={faceConsistency} onChange={e => setFaceConsistency(e.target.checked)} />
                                臉部一致性
                            </label>
                        </div>
                    </div>
                    
                    <div className="card">
                        <h2>3. 指令區</h2>
                        <div className="form-group">
                            <label htmlFor="user-prompt">簡短描述</label>
                            <textarea 
                                id="user-prompt" 
                                className="input" 
                                rows={3} 
                                value={userPrompt} 
                                onChange={e => setUserPrompt(e.target.value)}
                                placeholder="例如：一個開心的角色，戴著派對帽"
                            />
                        </div>
                         <button className="btn btn-primary btn-full" onClick={handleGenerateBase} disabled={isGenerateButtonDisabled}>
                            {isLoading && appStep === 'upload' ? '生成中...' : '生成主體貼圖'}
                        </button>
                    </div>

                    {appStep !== 'upload' && (
                      <div className="card">
                        <h2>4. 匯出選項</h2>
                         <div className="export-buttons">
                           <button className="btn btn-secondary" onClick={() => alert('ZIP 功能需要一個客戶端 JS 庫 (如 JSZip) 來實現。')} disabled={isLoading || (variants.length === 0 && !baseSticker)}>全部匯出 ZIP</button>
                           <button className="btn btn-secondary" onClick={handleExportMetadata} disabled={isLoading}>輸出 metadata.json</button>
                         </div>
                      </div>
                    )}

                </aside>

                <section className="results-panel">
                    {isLoading ? (
                        <div className="loader-container">
                            <div className="spinner"></div>
                            <p>{loadingMessage}</p>
                        </div>
                    ) : !baseSticker ? (
                        <div className="placeholder">
                            <p>您的專屬貼圖將會顯示在此處</p>
                        </div>
                    ) : (
                        <>
                          {error && <div className="error-message">{error}</div>}
                          <div className="sticker-gallery">
                            <div className="sticker-card">
                                <img src={baseSticker} alt="Base sticker" />
                                <div className="label">主體貼圖</div>
                                <button className="download-btn" title="下載" onClick={() => downloadDataUrl(baseSticker, 'base_sticker.png')}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
                                </button>
                            </div>
                            {variants.map(v => (
                               <div className="sticker-card" key={v.id}>
                                   <img src={v.uri} alt={v.label} />
                                   <div className="label">{v.label}</div>
                                   <button className="download-btn" title="下載" onClick={() => downloadDataUrl(v.uri, `${v.label}_sticker.png`)}>
                                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
                                  </button>
                               </div>
                            ))}
                          </div>
                          
                          {appStep === 'base_generated' && (
                              <div className="confirmation-area">
                                <h3>對主體貼圖滿意嗎？</h3>
                                <div className="btn-group">
                                    <button className="btn btn-secondary" onClick={handleGenerateBase}>重新生成</button>
                                    <button className="btn btn-primary" onClick={handleGenerateVariants}>✅ 確認並生成變化款</button>
                                </div>
                              </div>
                          )}

                          {appStep === 'variants_generated' && (
                            <div className="confirmation-area">
                                <h3>嘗試不同變化</h3>
                                <div className="btn-group">
                                    <button className="btn btn-primary" onClick={handleGenerateVariants} disabled={isLoading}>🔄 重新抽樣變化款</button>
                                </div>
                                <div className="custom-variants-card">
                                    <h4>或自訂情境 (以逗號分隔，最多 {MAX_CUSTOM_VARIANTS} 個)</h4>
                                    <div className="form-group">
                                        <textarea
                                            className="input"
                                            rows={3}
                                            value={customVariantsPrompt}
                                            onChange={e => setCustomVariantsPrompt(e.target.value)}
                                            placeholder="例如：yes, no, ok, 生氣, 不要, 不可以..."
                                        />
                                    </div>
                                    <button
                                        className="btn btn-secondary btn-full"
                                        onClick={handleGenerateCustomVariants}
                                        disabled={isLoading || !customVariantsPrompt.trim()}
                                    >
                                        生成自訂情境貼圖
                                    </tutton>
                                </div>
                            </div>
                          )}
                        </>
                    )}
                </section>
            </main>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
