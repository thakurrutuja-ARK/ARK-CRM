export type Client = {
    id: string;
    name: string;
    notes: string | null;
    categories: string[] | null;
    keywords: string[] | null;
    logo_url: string | null;
    created_at: string;
    created_by: string | null;
};

export type Document = {
    id: string;
    client_id: string;
    folder_id: string | null;
    file_name: string;
    storage_path: string;
    file_type: string | null;
    file_size: number | null;
    uploaded_by: string | null;
    created_at: string;
    content_text?: string | null;
    content_indexed_at?: string | null;
};

export type Folder = {
    id: string;
    client_id: string;
    name: string;
    created_at: string;
    created_by: string | null;
};

export type Category = {
    id: string;
    name: string;
    color_index: number;
    created_at: string;
    created_by: string | null;
};
